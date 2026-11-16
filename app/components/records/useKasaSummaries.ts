"use client";

import { useCallback, useMemo } from "react";
import { isDebtLeg } from "../../lib/debts";
import { tx } from "../../lib/i18n";
import { combineByCurrency, total } from "../../lib/finance";
import type { CashAccountSummary, KasaSection, Kind, Language, RecordItem } from "../../lib/types";

// Kasalar sayfasındaki kasa kartı verisi (kasa kaydı + bağlı gelir/gider).
export type CardGroup = {
  name: string;
  kind: Kind;
  count: number;
  totalInByCurrency: Record<string, number>;
  totalOutByCurrency: Record<string, number>;
  totalByCurrency: Record<string, number>;
};

// Kasalar/Gelir/Gider sayfalarındaki kasa kartları, çalışma alanları ve toplam kutuları için türetilmiş veriler.
// Yalnız prop'lardan hesaplanır (Records'un seçim durumuna bağlı değildir).
export function useKasaSummaries({
  records,
  allRecords,
  kind,
  cashAccounts,
  sections,
  language,
  workspaceOrder,
}: {
  records: RecordItem[];
  allRecords: RecordItem[];
  kind: Kind;
  cashAccounts: CashAccountSummary[];
  sections: KasaSection[];
  language: Language;
  workspaceOrder: string[];
}) {
  // "Liste Kasası" işaretli kasalar (Listeler ile ilişkili): üstteki kasa kartlarında değil, yalnızca "Tüm Liste Kasaları"
  // bölümünde görünür; kasanın kendi kayıtları listeli kayıt sayılır.
  // Kasa adı kümeleri yalnız kasalar/bölümler değişince yeniden kurulur; aşağıdaki useMemo'lar bunlara bağlıdır.
  const kasaListNames = useMemo(() => new Set(cashAccounts.filter((a) => a.isListWorkspace).map((a) => a.name)), [cashAccounts]);
  // "RJ-Kasaları": üstteki kasa kartlarında değil, kendi renkli bölümlerinde görünür (Liste Kasaları gibi ayrı tutulur).
  const kasaRjNames = useMemo(() => new Set(cashAccounts.filter((a) => a.isRjKasa).map((a) => a.name)), [cashAccounts]);
  const cashSections = useMemo(() => sections.filter((x) => x.scope === "cash"), [sections]);
  const kasaSectionNames = useMemo(
    () => new Set(cashAccounts.filter((a) => a.sectionId != null && cashSections.some((x) => x.id === a.sectionId)).map((a) => a.name)),
    [cashAccounts, cashSections],
  );
  const listOf = useCallback((x: RecordItem) => x.listName || (x.kind === "cash" && kasaListNames.has(x.source) ? x.source : ""), [kasaListNames]);
  const isListLinked = useCallback((x: RecordItem) => !!x.listName || kasaListNames.has(x.cashAccount), [kasaListNames]);
  // Liste ile ilişkilendirilen kayıtlar üst (ana) satırda kendi kartını
  // oluşturmaz — sadece aşağıdaki sarı "Tüm Liste ..." satırında görünür
  // (bkz. listGroups). Bir kasaya bağlı gelir/gider (linkedIncomeRows/
  // linkedExpenseRows) bu kuralın dışında tutulur: o para gerçekten o
  // kasaya girip çıktığı için, liste etiketli olsa bile kasanın üstteki
  // gerçek bakiyesinden düşülmemesi/eklenmemesi yanlış olur.
  const groups = useMemo(
    () =>
      // Gelir sayfasında kasanın kendi adıyla açılan kayıt kutuları (ör. "Ana -Kasa") ayrı kasa kutusunda (ör. "Ana -Kasa Gelirleri")
      // zaten toplandığı için burada tekrar edilmez.
      // Excel aktarımıyla gelen kayıtlar (yüzlerce ürün/kalem başlığı olabilir) tek tek kutu oluşturmaz; kasa kutusunda toplanır.
      [...new Set(records.filter((x) => !listOf(x) && !(kind !== "cash" && x.importBatch) && !(kind === "cash" && (kasaRjNames.has(x.source) || kasaSectionNames.has(x.source)))).map((x) => x.source))]
        .filter((name) => !(kind !== "cash" && cashAccounts.some((a) => a.name === name)))
        .map((name) => {
        const directRows = records.filter((x) => x.source === name && !listOf(x) && !(kind !== "cash" && x.importBatch));
        const linkedIncomeRows =
          kind === "cash"
            ? allRecords.filter((x) => x.kind === "income" && x.cashAccount === name)
            : [];
        const linkedExpenseRows =
          kind === "cash"
            ? allRecords.filter((x) => x.kind === "expense" && x.cashAccount === name)
            : [];
        const directAmount = total(directRows);
        const linkedIncome = total(linkedIncomeRows);
        const linkedExpense = total(linkedExpenseRows);
        return {
          name,
          kind: records.find((x) => x.source === name)?.kind ?? kind,
          kasas: [...new Set(directRows.map((r) => r.cashAccount).filter(Boolean))],
          count: directRows.length + linkedIncomeRows.length + linkedExpenseRows.length,
          totalIn: directAmount + linkedIncome,
          totalOut: linkedExpense,
          total: directAmount + linkedIncome - linkedExpense,
          totalInByCurrency: combineByCurrency([{ rows: directRows }, { rows: linkedIncomeRows }]),
          totalOutByCurrency: combineByCurrency([{ rows: linkedExpenseRows }]),
          totalByCurrency: combineByCurrency([
            { rows: directRows },
            { rows: linkedIncomeRows },
            { rows: linkedExpenseRows, sign: -1 },
          ]),
        };
      }),
    [records, allRecords, kind, cashAccounts, kasaRjNames, kasaSectionNames, listOf],
  );
  // Overall pill total, computed per currency directly from the record
  // arrays (not by summing groups' already-blended totals) so mixed
  // currencies show as separate amounts instead of one wrong number.
  // "Tüm Kasalar" toplamı: Listeler ile ilişkili (Liste Kasası) kasalar burada değil, "Tüm Liste Kasaları"nda sayılır.
  const overallByCurrency = useMemo(
    () =>
      combineByCurrency([
        { rows: records },
        { rows: kind === "cash" ? allRecords.filter((x) => x.kind === "income" && x.cashAccount) : [] },
        { rows: kind === "cash" ? allRecords.filter((x) => x.kind === "expense" && x.cashAccount) : [], sign: -1 },
      ]),
    [records, allRecords, kind],
  );
  const listedRecords = useMemo(() => records.filter((x) => listOf(x)), [records, listOf]);
  const listGroups = useMemo(
    () =>
      [...new Set(records.map((x) => listOf(x)).filter(Boolean))].map(
        (name) => {
          const directRows = records.filter((x) => listOf(x) === name);
          const linkedIncomeRows =
            kind === "cash"
              ? allRecords.filter((x) => x.kind === "income" && (x.listName === name || (kasaListNames.has(name) && x.cashAccount === name)))
              : [];
          const linkedExpenseRows =
            kind === "cash"
              ? allRecords.filter((x) => x.kind === "expense" && (x.listName === name || (kasaListNames.has(name) && x.cashAccount === name)))
              : [];
          const directAmount = total(directRows);
          const linkedIncome = total(linkedIncomeRows);
          const linkedExpense = total(linkedExpenseRows);
          return {
            name,
            count: records.filter((x) => listOf(x) === name).length,
            totalIn: directAmount + linkedIncome,
            totalOut: linkedExpense,
            total: directAmount + linkedIncome - linkedExpense,
            totalInByCurrency: combineByCurrency([{ rows: directRows }, { rows: linkedIncomeRows }]),
            totalOutByCurrency: combineByCurrency([{ rows: linkedExpenseRows }]),
            totalByCurrency: combineByCurrency([
              { rows: directRows },
              { rows: linkedIncomeRows },
              { rows: linkedExpenseRows, sign: -1 },
            ]),
          };
        },
      ),
    [records, allRecords, kind, kasaListNames, listOf],
  );
  // Kasa kutusu satırı (eskiden ayrı bir kasaBoxes hesabı vardı; yalnız türü kullanılıyordu).
  type KasaBox = { name: string; count: number; totalByCurrency: ReturnType<typeof combineByCurrency>; amount: number };
  // "Tüm Kasalar" / "Tüm Liste Kasaları" kutuları da tek tek kasa kartları gibi gelir ↗ ve gider ↘ satırını gösterir.
  const overallInOut = useMemo(() => {
    const incomeRows = kind === "cash" ? allRecords.filter((x) => x.kind === "income" && x.cashAccount) : [];
    const expenseRows = kind === "cash" ? allRecords.filter((x) => x.kind === "expense" && x.cashAccount) : [];
    return { inBy: combineByCurrency([{ rows: records }, { rows: incomeRows.filter((x) => !isDebtLeg(x)) }]), outBy: combineByCurrency([{ rows: expenseRows.filter((x) => !isDebtLeg(x)) }]) };
  }, [records, allRecords, kind]);
  // Gelir/Gider sayfalarında liste kayıtları, genel yönteme uygun olarak liste adına göre değil bağlı oldukları (Liste)
  // kasaya göre kutulanır: "DL-2026 Giderleri" gibi; kutuda o kasanın listeleri etiket olarak görünür.
  const listKasaBoxes = useMemo(() => {
    if (kind === "cash") return [];
    const byKasa = new Map<string, RecordItem[]>();
    for (const x of records) {
      if (!(listOf(x) || isListLinked(x))) continue;
      const k = x.cashAccount || x.source;
      byKasa.set(k, [...(byKasa.get(k) ?? []), x]);
    }
    return [...byKasa.entries()]
      .map(([name, rows]) => ({
        name,
        count: rows.length,
        amount: total(rows),
        totalByCurrency: combineByCurrency([{ rows }]),
        lists: [...new Set(rows.map((r) => r.listName).filter(Boolean))],
      }))
      .filter((b) => Math.abs(b.amount) > 0.004)
      .sort((a, b) => b.amount - a.amount);
  }, [records, kind, isListLinked, listOf]);
  // Çalışma alanları (Kasalar sayfası): Genel Kasalar, Liste Kasaları, RJ-Kasaları ve Ayarlar > Çalışma Alanları'ndan oluşturulanlar.
  // Her kasa yalnızca bir alanda görünür: önce seçili çalışma alanı, yoksa Liste Kasası / RJ-Kasası işareti, yoksa Genel Kasalar.
  const cashWorkspaces = useMemo(() => {
    if (kind !== "cash") return [];
    const names = [...new Set([...cashAccounts.map((a) => a.name), ...records.map((x) => x.source)].filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const accountOf = new Map(cashAccounts.map((a) => [a.name, a]));
    type Card = CardGroup & { direct: RecordItem[]; inc: RecordItem[]; exp: RecordItem[] };
    type Ws = { key: string; name: string; color: string; kasas: Card[]; parentKey?: string | null };
    const buckets: Ws[] = [
      { key: "genel", name: tx(language, "Diğer", "Other", "Yên din"), color: "#315fe8", kasas: [] },
      { key: "liste", name: tx(language, "Liste Kasaları", "List Cash Accounts", "Qaseyên Lîsteyê"), color: "#b9951c", kasas: [] },
      { key: "rj", name: tx(language, "RJ-Kasaları", "RJ Cash Accounts", "Qaseyên RJ"), color: "#7b52bf", kasas: [] },
      ...cashSections.map((section) => ({ key: `sec-${section.id}`, name: section.name, color: section.color, parentKey: section.parentKey ?? null, kasas: [] as Card[] })),
    ];
    for (const name of names) {
      const direct = records.filter((x) => x.source === name);
      const inc = allRecords.filter((x) => x.kind === "income" && x.cashAccount === name);
      const exp = allRecords.filter((x) => x.kind === "expense" && x.cashAccount === name);
      const card: Card = {
        name,
        kind: "cash",
        count: direct.length + inc.length + exp.length,
        totalInByCurrency: combineByCurrency([{ rows: direct }, { rows: inc.filter((x) => !isDebtLeg(x)) }]),
        totalOutByCurrency: combineByCurrency([{ rows: exp.filter((x) => !isDebtLeg(x)) }]),
        totalByCurrency: combineByCurrency([{ rows: direct }, { rows: inc }, { rows: exp, sign: -1 }]),
        direct,
        inc,
        exp,
      };
      const account = accountOf.get(name);
      const key = account?.sectionId != null && cashSections.some((x) => x.id === account.sectionId)
        ? `sec-${account.sectionId}`
        : account?.isListWorkspace ? "liste" : account?.isRjKasa ? "rj" : "genel";
      buckets.find((b) => b.key === key)?.kasas.push(card);
    }
    // Elle sıralama (Kasa Kontrol Merkezi): sortOrder > 0 olan kasalar önce, kendi sırasıyla; kalanlar adla.
    const orderOf = (name: string) => accountOf.get(name)?.sortOrder || 0;
    for (const b of buckets) b.kasas.sort((a, c) => (orderOf(a.name) || 1e9) - (orderOf(c.name) || 1e9));
    // Bölümler: başka bir çalışma alanının içine taşınan alanlar ana listede ayrı kutu olmaz; üst alanın içinde "bölüm" olarak görünür
    // ve toplamları üst alana dahil edilir.
    const calc = (kasas: Card[]) => {
      const parts = kasas.flatMap((k) => [{ rows: k.direct }, { rows: k.inc }]);
      const opParts = kasas.flatMap((k) => [{ rows: k.direct }, { rows: k.inc.filter((x) => !isDebtLeg(x)) }]);
      return {
        count: kasas.reduce((a, k) => a + k.count, 0),
        inBy: combineByCurrency(opParts),
        outBy: combineByCurrency(kasas.map((k) => ({ rows: k.exp.filter((x) => !isDebtLeg(x)) }))),
        totalBy: combineByCurrency([...parts, ...kasas.map((k) => ({ rows: k.exp, sign: -1 }))]),
      };
    };
    const known = new Set(buckets.map((b) => b.key));
    const isChild = (b: Ws) => Boolean(b.parentKey) && known.has(b.parentKey as string);
    return buckets
      .filter((b) => !isChild(b))
      .sort((a, c) => {
        const ia = workspaceOrder.indexOf(a.key), ic = workspaceOrder.indexOf(c.key);
        return (ia < 0 ? 1e9 : ia) - (ic < 0 ? 1e9 : ic);
      })
      .filter((b) => b.kasas.length > 0 || b.key.startsWith("sec-") || b.key === "genel" || buckets.some((s) => s.parentKey === b.key))
      .map((b) => {
        const subs = buckets
          .filter((s) => s.parentKey === b.key)
          .sort((x, y) => (sections.find((q) => `sec-${q.id}` === x.key)?.sortOrder || 1e9) - (sections.find((q) => `sec-${q.id}` === y.key)?.sortOrder || 1e9))
          .map((s) => ({ ...s, ...calc(s.kasas) }));
        const allKasas = [...b.kasas, ...subs.flatMap((s) => s.kasas)];
        return { ...b, subs, allKasas, ...calc(allKasas) };
      });
  }, [records, allRecords, kind, cashAccounts, sections, cashSections, language, workspaceOrder]);
  // Gelir/Gider sayfaları: kasa kutuları çalışma alanlarına göre gruplanır; üstte yalnızca alan kutuları görünür (ekran şişmesin),
  // bir alana basınca o alanın kasaları altta açılır. Bu sayfadaki türde (gelir/gider) kaydı olmayan alanlar gösterilmez.
  const ieWorkspaces = useMemo(() => {
    if (kind === "cash") return [];
    const accountOf = new Map(cashAccounts.map((a) => [a.name, a]));
    const buckets = [
      { key: "genel", name: tx(language, "Diğer", "Other", "Yên din"), color: "#315fe8", kasas: [] as KasaBox[] },
      { key: "liste", name: tx(language, "Liste Kasaları", "List Cash Accounts", "Qaseyên Lîsteyê"), color: "#b9951c", kasas: [] as KasaBox[] },
      { key: "rj", name: tx(language, "RJ-Kasaları", "RJ Cash Accounts", "Qaseyên RJ"), color: "#7b52bf", kasas: [] as KasaBox[] },
      ...cashSections.map((section) => ({ key: `sec-${section.id}`, name: section.name, color: section.color, kasas: [] as KasaBox[] })),
    ];
    const rowsByKasa = new Map<string, RecordItem[]>();
    for (const x of records) if (x.cashAccount) rowsByKasa.set(x.cashAccount, [...(rowsByKasa.get(x.cashAccount) ?? []), x]);
    for (const [name, rows] of rowsByKasa) {
      const account = accountOf.get(name);
      const key = account?.sectionId != null && cashSections.some((x) => x.id === account.sectionId)
        ? `sec-${account.sectionId}`
        : account?.isListWorkspace ? "liste" : account?.isRjKasa ? "rj" : "genel";
      buckets.find((b) => b.key === key)?.kasas.push({ name, count: rows.length, totalByCurrency: combineByCurrency([{ rows }]), amount: total(rows) });
    }
    return buckets
      .filter((b) => b.kasas.length > 0)
      .map((b) => {
        const rows = b.kasas.flatMap((k) => rowsByKasa.get(k.name) ?? []);
        return { ...b, kasas: [...b.kasas].sort((a, c) => c.amount - a.amount), count: rows.length, totalByCurrency: combineByCurrency([{ rows }]) };
      });
  }, [records, kind, cashAccounts, cashSections, language]);
  // Gelir/Gider bölüm kutuları: her bölüm için bir kutu (o bölümdeki kayıtların toplamı).
  const sectionBoxes = useMemo(
    () =>
      kind === "cash"
        ? []
        : sections
            .filter((x) => x.scope === kind)
            .map((section) => {
              const rows = records.filter((x) => x.sectionId === section.id);
              return { section, count: rows.length, totalByCurrency: combineByCurrency([{ rows }]) };
            }),
    [records, kind, sections],
  );
  const overallListInOut = useMemo(() => {
    const incomeRows = kind === "cash" ? allRecords.filter((x) => x.kind === "income" && isListLinked(x)) : [];
    const expenseRows = kind === "cash" ? allRecords.filter((x) => x.kind === "expense" && isListLinked(x)) : [];
    return { inBy: combineByCurrency([{ rows: listedRecords }, { rows: incomeRows }]), outBy: combineByCurrency([{ rows: expenseRows }]) };
  }, [listedRecords, allRecords, kind, isListLinked]);
  const overallListByCurrency = useMemo(
    () =>
      combineByCurrency([
        { rows: listedRecords },
        { rows: kind === "cash" ? allRecords.filter((x) => x.kind === "income" && isListLinked(x)) : [] },
        { rows: kind === "cash" ? allRecords.filter((x) => x.kind === "expense" && isListLinked(x)) : [], sign: -1 },
      ]),
    [listedRecords, allRecords, kind, isListLinked],
  );

  return {
    kasaListNames,
    kasaRjNames,
    cashSections,
    kasaSectionNames,
    listOf,
    isListLinked,
    groups,
    overallByCurrency,
    listedRecords,
    listGroups,
    overallInOut,
    listKasaBoxes,
    cashWorkspaces,
    ieWorkspaces,
    sectionBoxes,
    overallListInOut,
    overallListByCurrency,
  };
}
