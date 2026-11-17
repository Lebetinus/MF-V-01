"use client";

import { useMemo } from "react";
import { isDebtLeg } from "../../lib/debts";
import { combineByCurrency, total } from "../../lib/finance";
import type { CashAccountSummary, KasaSection, Kind, Language, RecordItem, RecordsView } from "../../lib/types";
import { NO_WORKSPACE, noWorkspaceLabel, workspaceKeyOf } from "../KasaManage";

// Kasa kartı ("kasa") ya da Gelir/Gider sayfasındaki başlık kutusu (kayıt türü).
export type CardGroup = {
  name: string;
  kind: Kind | "kasa";
  count: number;
  totalInByCurrency: Record<string, number>;
  totalOutByCurrency: Record<string, number>;
  totalByCurrency: Record<string, number>;
};

// Kasalar/Gelir/Gider sayfalarındaki kasa kartları, çalışma alanları ve toplam kutuları için türetilmiş veriler.
// Yalnız prop'lardan hesaplanır (Records'un seçim durumuna bağlı değildir).
// Kasa Kontrol Merkezi'nde (view "cash") kasalar cash_accounts satırlarıdır; her kasanın bakiyesi o kasadaki
// gelir − gider kayıtlarıdır (kasa aktarımı ve borç tarafları dahil). Ayrı bir "kasa kaydı" türü yoktur.
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
  kind: RecordsView;
  cashAccounts: CashAccountSummary[];
  sections: KasaSection[];
  language: Language;
  workspaceOrder: string[];
}) {
  const kasaPage = kind === "cash";
  // Kasa adı kümeleri yalnız kasalar/bölümler değişince yeniden kurulur; aşağıdaki useMemo'lar bunlara bağlıdır.
  const cashSections = useMemo(() => sections.filter((x) => x.scope === "cash"), [sections]);
  const kasaSectionNames = useMemo(
    () => new Set(cashAccounts.filter((a) => a.sectionId != null && cashSections.some((x) => x.id === a.sectionId)).map((a) => a.name)),
    [cashAccounts, cashSections],
  );
  // Kasaya bağlı gelir/gider kayıtları (Kasa Kontrol Merkezi'nin tüm rakamları bunlardan çıkar).
  const kasaIncome = useMemo(() => allRecords.filter((x) => x.kind === "income" && x.cashAccount), [allRecords]);
  const kasaExpense = useMemo(() => allRecords.filter((x) => x.kind === "expense" && x.cashAccount), [allRecords]);
  // Gelir/Gider sayfalarındaki başlık kutuları (ana başlığa göre). Excel aktarımıyla gelen kayıtlar (yüzlerce kalem
  // başlığı olabilir) kendi kutusunu oluşturmaz; kasa kutusunda toplanır.
  // Kasanın kendi adıyla açılan başlıklar ayrı kasa kutusunda zaten toplandığı için tekrar edilmez.
  const groups = useMemo(
    () =>
      kasaPage
        ? []
        : [...new Set(records.filter((x) => !x.importBatch).map((x) => x.source))]
            .filter((name) => !cashAccounts.some((a) => a.name === name))
            .map((name) => {
              const directRows = records.filter((x) => x.source === name && !x.importBatch);
              const by = combineByCurrency([{ rows: directRows }]);
              return {
                name,
                kind: kind as Kind,
                kasas: [...new Set(directRows.map((r) => r.cashAccount).filter(Boolean))],
                count: directRows.length,
                totalIn: total(directRows),
                totalOut: 0,
                total: total(directRows),
                totalInByCurrency: by,
                totalOutByCurrency: {},
                totalByCurrency: by,
              };
            }),
    [records, kind, kasaPage, cashAccounts],
  );
  // Overall pill total, computed per currency directly from the record
  // arrays (not by summing groups' already-blended totals) so mixed
  // currencies show as separate amounts instead of one wrong number.
  // Kasa Kontrol Merkezi'nde "Tüm Kasalar" = tüm kasaların bakiyesi (gelir − gider).
  const overallByCurrency = useMemo(
    () => (kasaPage ? combineByCurrency([{ rows: kasaIncome }, { rows: kasaExpense, sign: -1 }]) : combineByCurrency([{ rows: records }])),
    [records, kasaPage, kasaIncome, kasaExpense],
  );
  // Kasa kutusu satırı (eskiden ayrı bir kasaBoxes hesabı vardı; yalnız türü kullanılıyordu).
  type KasaBox = { name: string; count: number; totalByCurrency: ReturnType<typeof combineByCurrency>; amount: number };
  // "Tüm Kasalar" kutusu da tek tek kasa kartları gibi kasaya giren ↗ ve çıkan ↘ parayı gösterir (borç tarafları hariç).
  const overallInOut = useMemo(
    () =>
      kasaPage
        ? { inBy: combineByCurrency([{ rows: kasaIncome.filter((x) => !isDebtLeg(x)) }]), outBy: combineByCurrency([{ rows: kasaExpense.filter((x) => !isDebtLeg(x)) }]) }
        : { inBy: combineByCurrency([{ rows: records }]), outBy: {} as Record<string, number> },
    [records, kasaPage, kasaIncome, kasaExpense],
  );
  // Çalışma alanları (Kasa Kontrol Merkezi): yöneticinin oluşturduğu alanlar ve içlerindeki bölümler; hazır alan yoktur.
  // Her kasa yalnızca kendi alanında / bölümünde görünür. Alanı olmayan kasa (eski içe aktarım vb.) kaybolmasın diye
  // yalnız böyle bir kasa varsa "Çalışma alanı yok" kutusu çıkar.
  // Kasalar cash_accounts satırlarıdır (+ kaydında adı geçen ama listede olmayan kasa adları, bakiyesi kaybolmasın).
  const cashWorkspaces = useMemo(() => {
    if (!kasaPage) return [];
    const names = [...new Set([...cashAccounts.map((a) => a.name), ...kasaIncome.map((x) => x.cashAccount), ...kasaExpense.map((x) => x.cashAccount)].filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const accountOf = new Map(cashAccounts.map((a) => [a.name, a]));
    const incOf = new Map<string, RecordItem[]>();
    const expOf = new Map<string, RecordItem[]>();
    for (const x of kasaIncome) incOf.set(x.cashAccount, [...(incOf.get(x.cashAccount) ?? []), x]);
    for (const x of kasaExpense) expOf.set(x.cashAccount, [...(expOf.get(x.cashAccount) ?? []), x]);
    type Card = CardGroup & { inc: RecordItem[]; exp: RecordItem[] };
    type Ws = { key: string; name: string; color: string; kasas: Card[]; parentKey?: string | null };
    const buckets: Ws[] = [
      ...cashSections.map((section) => ({ key: `sec-${section.id}`, name: section.name, color: section.color, parentKey: section.parentKey ?? null, kasas: [] as Card[] })),
      { key: NO_WORKSPACE, name: noWorkspaceLabel(language), color: "#8a8f98", kasas: [] },
    ];
    for (const name of names) {
      const inc = incOf.get(name) ?? [];
      const exp = expOf.get(name) ?? [];
      const card: Card = {
        name,
        kind: "kasa",
        count: inc.length + exp.length,
        totalInByCurrency: combineByCurrency([{ rows: inc.filter((x) => !isDebtLeg(x)) }]),
        totalOutByCurrency: combineByCurrency([{ rows: exp.filter((x) => !isDebtLeg(x)) }]),
        totalByCurrency: combineByCurrency([{ rows: inc }, { rows: exp, sign: -1 }]),
        inc,
        exp,
      };
      const key = workspaceKeyOf(accountOf.get(name)?.sectionId, cashSections);
      buckets.find((b) => b.key === key)?.kasas.push(card);
    }
    // Elle sıralama (Kasa Kontrol Merkezi): sortOrder > 0 olan kasalar önce, kendi sırasıyla; kalanlar adla.
    const orderOf = (name: string) => accountOf.get(name)?.sortOrder || 0;
    for (const b of buckets) b.kasas.sort((a, c) => (orderOf(a.name) || 1e9) - (orderOf(c.name) || 1e9));
    // Bölümler: başka bir çalışma alanının içine taşınan alanlar ana listede ayrı kutu olmaz; üst alanın içinde "bölüm" olarak görünür
    // ve toplamları üst alana dahil edilir.
    const calc = (kasas: Card[]) => ({
      count: kasas.reduce((a, k) => a + k.count, 0),
      inBy: combineByCurrency(kasas.map((k) => ({ rows: k.inc.filter((x) => !isDebtLeg(x)) }))),
      outBy: combineByCurrency(kasas.map((k) => ({ rows: k.exp.filter((x) => !isDebtLeg(x)) }))),
      totalBy: combineByCurrency([...kasas.map((k) => ({ rows: k.inc })), ...kasas.map((k) => ({ rows: k.exp, sign: -1 }))]),
    });
    const known = new Set(buckets.map((b) => b.key));
    const isChild = (b: Ws) => Boolean(b.parentKey) && known.has(b.parentKey as string);
    return buckets
      .filter((b) => !isChild(b))
      .sort((a, c) => {
        const ia = workspaceOrder.indexOf(a.key), ic = workspaceOrder.indexOf(c.key);
        return (ia < 0 ? 1e9 : ia) - (ic < 0 ? 1e9 : ic);
      })
      .filter((b) => b.key !== NO_WORKSPACE || b.kasas.length > 0)
      .map((b) => {
        const subs = buckets
          .filter((s) => s.parentKey === b.key)
          .sort((x, y) => (sections.find((q) => `sec-${q.id}` === x.key)?.sortOrder || 1e9) - (sections.find((q) => `sec-${q.id}` === y.key)?.sortOrder || 1e9))
          .map((s) => ({ ...s, ...calc(s.kasas) }));
        const allKasas = [...b.kasas, ...subs.flatMap((s) => s.kasas)];
        return { ...b, subs, allKasas, ...calc(allKasas) };
      });
  }, [kasaPage, kasaIncome, kasaExpense, cashAccounts, sections, cashSections, language, workspaceOrder]);
  // Gelir/Gider sayfaları: kasa kutuları çalışma alanlarına göre gruplanır; üstte yalnızca alan kutuları görünür (ekran şişmesin),
  // bir alana basınca o alanın kasaları altta açılır. Bu sayfadaki türde (gelir/gider) kaydı olmayan alanlar gösterilmez.
  const ieWorkspaces = useMemo(() => {
    if (kasaPage) return [];
    const accountOf = new Map(cashAccounts.map((a) => [a.name, a]));
    const buckets = [
      ...cashSections.map((section) => ({ key: `sec-${section.id}`, name: section.name, color: section.color, kasas: [] as KasaBox[] })),
      { key: NO_WORKSPACE, name: noWorkspaceLabel(language), color: "#8a8f98", kasas: [] as KasaBox[] },
    ];
    const rowsByKasa = new Map<string, RecordItem[]>();
    for (const x of records) if (x.cashAccount) rowsByKasa.set(x.cashAccount, [...(rowsByKasa.get(x.cashAccount) ?? []), x]);
    for (const [name, rows] of rowsByKasa) {
      const key = workspaceKeyOf(accountOf.get(name)?.sectionId, cashSections);
      buckets.find((b) => b.key === key)?.kasas.push({ name, count: rows.length, totalByCurrency: combineByCurrency([{ rows }]), amount: total(rows) });
    }
    return buckets
      .filter((b) => b.kasas.length > 0)
      .map((b) => {
        const rows = b.kasas.flatMap((k) => rowsByKasa.get(k.name) ?? []);
        return { ...b, kasas: [...b.kasas].sort((a, c) => c.amount - a.amount), count: rows.length, totalByCurrency: combineByCurrency([{ rows }]) };
      });
  }, [records, kasaPage, cashAccounts, cashSections, language]);
  // Gelir/Gider bölüm kutuları: her bölüm için bir kutu (o bölümdeki kayıtların toplamı).
  const sectionBoxes = useMemo(
    () =>
      kasaPage
        ? []
        : sections
            .filter((x) => x.scope === kind)
            .map((section) => {
              const rows = records.filter((x) => x.sectionId === section.id);
              return { section, count: rows.length, totalByCurrency: combineByCurrency([{ rows }]) };
            }),
    [records, kind, kasaPage, sections],
  );

  return {
    cashSections,
    kasaSectionNames,
    groups,
    overallByCurrency,
    overallInOut,
    cashWorkspaces,
    ieWorkspaces,
    sectionBoxes,
  };
}
