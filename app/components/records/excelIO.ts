"use client";

import { downloadWorkbook, newWorkbook } from "../../lib/excel";
import { tx } from "../../lib/i18n";
import { date, parseImportDate } from "../../lib/finance";
import type { Kind, Language, RecordItem } from "../../lib/types";
import { notify } from "../../lib/notify";

// Kasalar/Gelir/Gider tablosunu Excel'e çıkarır ("Excel ve Rapor" menüsü ve seçili satırlar).
// Her satır bir gelir ya da gider kaydıdır; "Kasa" sütunu kaydın kasasıdır.
export async function exportRecordsExcel(
  rowsToExport: RecordItem[],
  suffix: string,
  { language, source, title }: { language: Language; source: string; title: string },
) {
  const columns = [
    tx(language, "Tarih", "Date", "Tarîx"),
    tx(language, "Ana Başlık", "Category", "Sernav"),
    tx(language, "Detay", "Detail", "Hûragahî"),
    tx(language, "Not", "Note", "Nîşe"),
    tx(language, "Kişi", "Person", "Kes"),
    tx(language, "Miktar", "Amount", "Meblağ"),
    tx(language, "Para Birimi", "Currency", "Yekeya Pere"),
    tx(language, "Proje / Birim", "Project / Unit", "Proje / Yekîne"),
    tx(language, "Etiketler", "Tags", "Etîket"),
    tx(language, "Tür", "Type", "Cure"),
    tx(language, "Kasa", "Cash Account", "Qase"),
  ];
  const workbook = await newWorkbook();
  const sheet = workbook.addWorksheet("Kayitlar");
  sheet.addRow(columns);
  for (const x of rowsToExport) {
    sheet.addRow([
      date(x.date),
      x.source,
      x.detail,
      x.note,
      x.person,
      x.amount,
      x.currency,
      x.project,
      x.tags.join(", "),
      x.kind === "income" ? tx(language, "Gelir", "Income", "Dahat") : tx(language, "Gider", "Expense", "Mesref"),
      x.cashAccount,
    ]);
  }
  const safeName = (source === "Tümü" ? title : source).replace(/[\\/:*?"<>|]/g, "-");
  await downloadWorkbook(workbook, `${safeName}${suffix}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Bu tablonun biçimindeki .xlsx dosyasını Gelir/Gider sayfasına kayıt olarak içe aktarır (Kasa Kontrol Merkezi'nde
// bu içe aktarma yoktur: kasalar "Yeni Kasa" ile açılır, Excel raporları "Rapor yükle" ile kasaya işlenir).
export async function importRecordsExcel(
  file: File | undefined,
  {
    language,
    kind,
    source,
    records,
    onImport,
  }: { language: Language; kind: Kind; source: string; records: RecordItem[]; onImport: (rows: Omit<RecordItem, "id">[]) => void },
) {
  if (!file) return;
  try {
    const workbook = await newWorkbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error();
    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber] = String(cell.value ?? "").trim();
    });
    const raw: { rowNumber: number; row: Record<string, unknown> }[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const record: Record<string, unknown> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = headers[colNumber];
        if (!header) return;
        const value = cell.value;
        record[header] = value && typeof value === "object" && "text" in (value as object)
          ? (value as { text: string }).text
          : value ?? "";
      });
      raw.push({ rowNumber, row: record });
    });
    const invalidDateRows: number[] = [];
    const imported = raw
      .map(({ rowNumber, row }): (Omit<RecordItem, "id"> & { rowNumber: number }) | null => {
        const values = Object.values(row);
        const get = (...names: string[]) => {
          for (const name of names)
            if (row[name] !== undefined && row[name] !== "") return row[name];
          return "";
        };
        const excelDate = get("Tarih", "Date", "Tarîx");
        // Import is the one place a bad date shouldn't silently become
        // "today" — that would misfile a transaction under the wrong day
        // without anyone noticing. Reject the row instead.
        const parsedDate = parseImportDate(excelDate || values[0]);
        if (!parsedDate) {
          invalidDateRows.push(rowNumber);
          return null;
        }
        const resolvedSource =
          source !== "Tümü"
            ? source
            : String(
                get(
                  "Ana Başlık",
                  "Category",
                  "Sernav",
                ) ||
                  values[1] ||
                  "Excel Aktarımı",
              );
        return {
          rowNumber,
          kind,
          date: parsedDate,
          source: resolvedSource,
          detail: String(
            get("Detay", "Detail", "Hûragahî") || values[2] || "",
          ),
          note: String(get("Not", "Note", "Nîşe") || ""),
          person: String(get("Kişi", "Person", "Kes") || ""),
          amount: Number(get("Miktar", "Amount", "Meblağ") || 0),
          currency: String(
            get("Para Birimi", "Currency", "Yekeya Pere") || "USD",
          ),
          project: String(
            get("Proje / Birim", "Project / Unit", "Proje / Yekîne") || "",
          ),
          tags: String(get("Etiketler", "Tags", "Etîket") || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          cashAccount: resolvedSource,
          listName: "",
        };
      })
      .filter((x): x is Omit<RecordItem, "id"> & { rowNumber: number } => x !== null && Boolean(x.source) && Number.isFinite(x.amount))
      .map(({ rowNumber: _rowNumber, ...record }) => record);
    if (!imported.length && !invalidDateRows.length) throw new Error();

    const duplicateCount = imported.filter((x) =>
      records.some((existing) => existing.date === x.date && existing.amount === x.amount && existing.currency === x.currency && existing.source === x.source),
    ).length;
    if (duplicateCount > 0) {
      const proceed = window.confirm(
        tx(
          language,
          `İçe aktarılacak ${imported.length} kayıttan ${duplicateCount} tanesi mevcut kayıtlarla aynı tarih, tutar ve başlığa sahip. Yine de içe aktarmak istiyor musunuz?`,
          `${duplicateCount} of the ${imported.length} rows to import match an existing record's date, amount and title. Import anyway?`,
          `${duplicateCount} ji ${imported.length} rêzên ku dê werin têxistin, bi heman tarîx, meblağ û sernavê qeydek heyî re li hev in. Dîsa jî têxistin?`,
        ),
      );
      if (!proceed) return;
    }

    if (imported.length) onImport(imported);
    const skippedNote = invalidDateRows.length
      ? tx(
          language,
          ` (${invalidDateRows.length} satır geçersiz tarih nedeniyle atlandı: satır ${invalidDateRows.join(", ")})`,
          ` (${invalidDateRows.length} row(s) skipped for invalid dates: row ${invalidDateRows.join(", ")})`,
          ` (${invalidDateRows.length} rêz ji ber tarîxa nederbasdar hatin derbasqilkirin: rêz ${invalidDateRows.join(", ")})`,
        )
      : "";
    notify(
      tx(
        language,
        `${imported.length} kayıt Excel'den eklendi.${skippedNote}`,
        `${imported.length} records imported from Excel.${skippedNote}`,
        `${imported.length} qeyd ji Excelê hatin têxistin.${skippedNote}`,
      ),
      "success",
    );
  } catch {
    notify(
      tx(
        language,
        "Excel dosyası okunamadı. Lütfen ilk satırda sütun başlıkları bulunan .xlsx dosyası seçin.",
        "The Excel file could not be read. Choose an .xlsx file with column headers in the first row.",
        "Pelê Excelê nehat xwendin. Pelek .xlsx ku di rêza yekem de sernavên stûnan heye hilbijêre.",
      ),
    );
  }
}
