"use client";

import { useState } from "react";
import { downloadWorkbook, newWorkbook } from "../../lib/excel";
import { tx, localizeData } from "../../lib/i18n";
import { combineByCurrency, date, money, moneyBreakdown, total } from "../../lib/finance";
import { isDebtLeg } from "../../lib/debts";
import type { Language, RecordItem } from "../../lib/types";

// "Sonuç Oluştur" ile açılan kasa özet raporu — bir kasanın Gelir/Gider
// dökümünü ve toplam sonucunu tek pencerede gösterir, Excel'e aktarılabilir.
// Sayfadaki Gelir/Gider kutularıyla aynı renk dilini kullanır (yeşil/
// turuncu) ama kendi başlık/ölçek hiyerarşisiyle bir "rapor" hissi verir.
export type KasaReportData = {
  name: string;
  incomeRows: RecordItem[];
  expenseRows: RecordItem[];
  totalInByCurrency: Record<string, number>;
  totalOutByCurrency: Record<string, number>;
  totalByCurrency: Record<string, number>;
  totalInAmount: number;
  totalOutAmount: number;
};

// Bir kasanın gelir ve gider kayıtları (kasa bakiyesi = gelir − gider, tüm kayıtlar). Gelir/gider toplamlarına
// borç veren tarafın borç kayıtları (lent / collected) girmez; bakiyeye girer (bkz. app/lib/debts.ts).
export function computeKasaReportData(name: string, allRecords: RecordItem[]): KasaReportData {
  const incomeRows = allRecords.filter((x) => x.kind === "income" && x.cashAccount === name).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  const expenseRows = allRecords.filter((x) => x.kind === "expense" && x.cashAccount === name).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  return {
    name,
    incomeRows,
    expenseRows,
    totalInByCurrency: combineByCurrency([{ rows: incomeRows.filter((x) => !isDebtLeg(x)) }]),
    totalOutByCurrency: combineByCurrency([{ rows: expenseRows.filter((x) => !isDebtLeg(x)) }]),
    totalByCurrency: combineByCurrency([{ rows: incomeRows }, { rows: expenseRows, sign: -1 }]),
    totalInAmount: total(incomeRows.filter((x) => !isDebtLeg(x))),
    totalOutAmount: total(expenseRows.filter((x) => !isDebtLeg(x))),
  };
}

// Sayfadaki "Gelir – Gider Analizi" (bkz. Dashboard.tsx) ile aynı .bars
// görsel dilini burada da kullanıyor — ayrı bir bileşen olarak dışa
// aktarılmadığı için küçük bir kopyası; renk/şekil ana sistemle bire bir
// aynı kalsın diye.
export function KasaReportBar({ label, value, max, expense }: { label: string; value: number; max: number; expense?: boolean }) {
  return (
    <div>
      <span>
        <b>{label}</b>
        <strong>{money(value)}</strong>
      </span>
      <i>
        <em
          className={expense ? "expense" : ""}
          style={{ width: `${Math.max(4, (Math.abs(value) / max) * 100)}%` }}
        />
      </i>
    </div>
  );
}

// "Sonuç Oluştur" ile açılan kasa özet raporu — bir veya birden çok
// kasanın Gelir/Gider dökümünü, mini bir analiz çizelgesini ve toplam
// sonucunu tek pencerede gösterir, Excel'e aktarılabilir. Sayfadaki
// Gelir/Gider kutularıyla aynı renk dilini kullanır (yeşil/turuncu/teal).
export function mergeCurrencyMaps(maps: Record<string, number>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of maps) for (const [c, v] of Object.entries(m)) out[c] = (out[c] ?? 0) + v;
  return out;
}

// Sonuç Oluştur penceresine 2., 3. kasa eklendiğinde ayrı ayrı değil,
// seçilmiş ilk kasanın sonucuyla BİRLEŞTİRİLEREK tek bir Gelir/Gider/Sonuç
// hâline getirilir — ayrı ayrı görmek isteyen kullanıcı zaten pencereyi
// her kasa için tek tek açabilir. Birden çok kasa satırları karışınca
// hangi kayıt hangi kasaya ait olduğu görünsün diye satıra kasa adı
// etiketlenir (bkz. TaggedRow / kasaReportRowKasa).
export type TaggedRow = { row: RecordItem; kasaName: string };

export function KasaResultModal({
  language,
  initialKasaName,
  kasaOptions,
  allRecords,
  onClose,
}: {
  language: Language;
  initialKasaName: string;
  kasaOptions: string[];
  allRecords: RecordItem[];
  onClose: () => void;
}) {
  const [selectedKasas, setSelectedKasas] = useState<string[]>([initialKasaName]);
  const [pendingAdd, setPendingAdd] = useState("");
  const reportDate = date(new Date().toISOString().slice(0, 10), language);
  const availableToAdd = kasaOptions.filter((n) => !selectedKasas.includes(n));
  const kasaBlocks = selectedKasas.map((name) => computeKasaReportData(name, allRecords));
  const isMulti = kasaBlocks.length > 1;

  const mergedIncome: TaggedRow[] = kasaBlocks
    .flatMap((d) => d.incomeRows.map((row) => ({ row, kasaName: d.name })))
    .sort((a, b) => b.row.date.localeCompare(a.row.date) || b.row.id - a.row.id);
  const mergedExpense: TaggedRow[] = kasaBlocks
    .flatMap((d) => d.expenseRows.map((row) => ({ row, kasaName: d.name })))
    .sort((a, b) => b.row.date.localeCompare(a.row.date) || b.row.id - a.row.id);
  const mergedTotalInByCurrency = mergeCurrencyMaps(kasaBlocks.map((d) => d.totalInByCurrency));
  const mergedTotalOutByCurrency = mergeCurrencyMaps(kasaBlocks.map((d) => d.totalOutByCurrency));
  const mergedTotalByCurrency = mergeCurrencyMaps(kasaBlocks.map((d) => d.totalByCurrency));
  const mergedTotalInAmount = kasaBlocks.reduce((s, d) => s + d.totalInAmount, 0);
  const mergedTotalOutAmount = kasaBlocks.reduce((s, d) => s + d.totalOutAmount, 0);
  const combinedTitle = kasaBlocks.map((d) => localizeData(d.name, language)).join(" + ");

  function addKasa() {
    if (!pendingAdd) return;
    setSelectedKasas((cur) => (cur.includes(pendingAdd) ? cur : [...cur, pendingAdd]));
    setPendingAdd("");
  }
  function removeKasa(name: string) {
    setSelectedKasas((cur) => (cur.length > 1 ? cur.filter((n) => n !== name) : cur));
  }

  async function exportToExcel() {
    const workbook = await newWorkbook();
    workbook.creator = "Maliye-Finans Online";
    workbook.created = new Date();
    const headers = isMulti
      ? [
          tx(language, "Tarih", "Date", "Tarîx"),
          tx(language, "Kasa", "Kasa", "Qase"),
          tx(language, "Başlık", "Title", "Sernav"),
          tx(language, "Kişi", "Person", "Kes"),
          tx(language, "Tutar", "Amount", "Meblağ"),
        ]
      : [
          tx(language, "Tarih", "Date", "Tarîx"),
          tx(language, "Başlık", "Title", "Sernav"),
          tx(language, "Kişi", "Person", "Kes"),
          tx(language, "Tutar", "Amount", "Meblağ"),
        ];
    const colCount = headers.length;
    const thin = { style: "thin" as const, color: { argb: "FFD3DDDD" } };
    const border = { top: thin, left: thin, bottom: thin, right: thin };
    const moneyFormat = "#,##0.00;[Red]-#,##0.00";

    const sheet = workbook.addWorksheet(
      tx(language, "Kasa Sonucu", "Cash Result", "Encama Qaseyê").slice(0, 31),
      {
        pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
        views: [{ showGridLines: false }],
      },
    );
    sheet.columns = isMulti
      ? [{ width: 14 }, { width: 20 }, { width: 30 }, { width: 20 }, { width: 18 }]
      : [{ width: 14 }, { width: 34 }, { width: 22 }, { width: 18 }];

    const titleRow = sheet.addRow([combinedTitle]);
    sheet.mergeCells(titleRow.number, 1, titleRow.number, colCount);
    titleRow.height = 28;
    titleRow.getCell(1).font = { name: "Arial", bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176B87" } };
    titleRow.eachCell({ includeEmpty: true }, (cell) => { cell.border = border; });

    const subRow = sheet.addRow([
      `${tx(language, "Toplam Sonucu", "Total Result", "Encama Giştî")}: ${moneyBreakdown(mergedTotalByCurrency)}`,
    ]);
    sheet.mergeCells(subRow.number, 1, subRow.number, colCount);
    subRow.height = 22;
    subRow.getCell(1).font = { name: "Arial", bold: true, size: 12, color: { argb: "FF17384A" } };
    subRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    subRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEEF3" } };
    subRow.eachCell({ includeEmpty: true }, (cell) => { cell.border = border; });
    sheet.addRow([]);

    function addSection(
      sectionTitle: string,
      rows: TaggedRow[],
      sectionTotal: Record<string, number>,
      headFill: string,
      headColor: string,
      totalFill: string,
    ) {
      const sectionHead = sheet.addRow([sectionTitle]);
      sheet.mergeCells(sectionHead.number, 1, sectionHead.number, colCount);
      sectionHead.height = 22;
      sectionHead.getCell(1).font = { name: "Arial", bold: true, size: 12, color: { argb: headColor } };
      sectionHead.getCell(1).alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      sectionHead.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: headFill } };
      sectionHead.eachCell({ includeEmpty: true }, (cell) => { cell.border = border; });

      const headerRow = sheet.addRow(headers);
      headerRow.height = 18;
      headerRow.eachCell((cell) => {
        cell.font = { name: "Arial", bold: true, size: 9, color: { argb: "FF5B6F77" } };
        cell.alignment = { vertical: "middle", horizontal: "left" };
        cell.border = border;
      });

      for (const { row: r, kasaName } of rows) {
        const values = isMulti
          ? [date(r.date, language), localizeData(kasaName, language), localizeData(r.source, language), localizeData(r.person, language), r.amount]
          : [date(r.date, language), localizeData(r.source, language), localizeData(r.person, language), r.amount];
        const row = sheet.addRow(values);
        row.height = 18;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.font = { name: "Arial", size: 9, color: { argb: "FF314750" } };
          cell.alignment = { vertical: "middle", horizontal: colNumber === colCount ? "right" : "left" };
          cell.border = border;
        });
        row.getCell(colCount).numFmt = moneyFormat;
      }
      if (!rows.length) {
        const emptyRow = sheet.addRow([tx(language, "Kayıt yok.", "No records.", "Qeyd tune.")]);
        sheet.mergeCells(emptyRow.number, 1, emptyRow.number, colCount);
        emptyRow.getCell(1).font = { name: "Arial", italic: true, size: 9, color: { argb: "FF9AA7AB" } };
        emptyRow.getCell(1).alignment = { horizontal: "center" };
      }
      const totalRow = sheet.addRow([
        tx(language, "Sonuç", "Result", "Encam"),
        ...Array(colCount - 2).fill(""),
        moneyBreakdown(sectionTotal),
      ]);
      sheet.mergeCells(totalRow.number, 1, totalRow.number, colCount - 1);
      totalRow.height = 20;
      totalRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.font = { name: "Arial", bold: true, size: 10, color: { argb: "FF17384A" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: totalFill } };
        cell.alignment = { vertical: "middle", horizontal: colNumber === 1 ? "left" : "right" };
        cell.border = border;
      });
      sheet.addRow([]);
    }

    addSection(tx(language, "GELİR", "INCOME", "DAHAT"), mergedIncome, mergedTotalInByCurrency, "FFDFF5ED", "FF118164", "FFE7F4EF");
    addSection(tx(language, "GİDER", "EXPENSE", "MESREF"), mergedExpense, mergedTotalOutByCurrency, "FFFFF0DF", "FFD06F22", "FFFDF1E7");

    // Sonuç satırları — her biri ekrandaki renk bloğuyla eşleşen bir dolgu
    // rengi alır, sadece metin rengiyle sınırlı kalmaz.
    const summaryLines: [string, string, string, string][] = [
      [tx(language, "KASA SONUÇ", "CASH RESULT", "ENCAMA QASEYÊ"), moneyBreakdown(mergedTotalByCurrency), "FFEAF4F7", "FF12414F"],
      [tx(language, "TOPLAM GELİR", "TOTAL INCOME", "DAHATA GİŞTÎ"), moneyBreakdown(mergedTotalInByCurrency), "FFE7F4EF", "FF14795E"],
      [tx(language, "TOPLAM GİDER", "TOTAL EXPENSE", "MESREFA GİŞTÎ"), moneyBreakdown(mergedTotalOutByCurrency), "FFFDF1E7", "FFB33D3D"],
      [tx(language, "TARİH", "DATE", "TARÎX"), reportDate, "FFF5F7F8", "FF5B6F77"],
    ];
    for (const [label, value, fill, color] of summaryLines) {
      const row = sheet.addRow([label, ...Array(colCount - 2).fill(""), value]);
      sheet.mergeCells(row.number, 1, row.number, colCount - 1);
      row.height = 20;
      row.getCell(1).font = { name: "Arial", bold: true, size: 10, color: { argb: color } };
      row.getCell(colCount).font = { name: "Arial", bold: true, size: 11, color: { argb: color } };
      row.getCell(colCount).alignment = { horizontal: "right" };
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        cell.border = border;
      });
    }

    const safeName = kasaBlocks.map((d) => localizeData(d.name, language)).join("-").replace(/[\\/:*?"<>|]/g, "-");
    await downloadWorkbook(workbook, `${safeName}-Sonuc-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="overlay">
      <div className="modal kasaReportModal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <div>
            <h2>{tx(language, "Kasa Sonuç Raporu", "Cash Result Report", "Rapora Encama Qaseyê")}</h2>
            <p>{combinedTitle}</p>
          </div>
          <button type="button" onClick={onClose}>×</button>
        </div>
        {availableToAdd.length > 0 && (
          <div className="kasaReportAdd">
            <select value={pendingAdd} onChange={(e) => setPendingAdd(e.target.value)}>
              <option value="">
                {tx(language, "— Başka kasa ekle —", "— Add another kasa —", "— Qaseyek din zêde bike —")}
              </option>
              {availableToAdd.map((name) => (
                <option key={name} value={name}>{localizeData(name, language)}</option>
              ))}
            </select>
            <button type="button" className="light compact" onClick={addKasa} disabled={!pendingAdd}>
              ＋ {tx(language, "Ekle", "Add", "Zêde Bike")}
            </button>
          </div>
        )}
        {isMulti && (
          <div className="kasaReportChips">
            {selectedKasas.map((name) => (
              <span className="kasaReportChip" key={name}>
                {localizeData(name, language)}
                <button
                  type="button"
                  onClick={() => removeKasa(name)}
                  title={tx(language, "Bu kasayı kaldır", "Remove this kasa", "Vê qaseyê rake")}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="kasaReportHead">
          <span>{combinedTitle}</span>
          <div>
            <small>{tx(language, "Toplam Sonucu", "Total Result", "Encama Giştî")}</small>
            <strong>{moneyBreakdown(mergedTotalByCurrency)}</strong>
          </div>
        </div>
        <div className="bars kasaReportBars">
          <KasaReportBar
            label={tx(language, "Gelir", "Income", "Dahat")}
            value={mergedTotalInAmount}
            max={Math.max(mergedTotalInAmount, mergedTotalOutAmount, 1)}
          />
          <KasaReportBar
            label={tx(language, "Gider", "Expense", "Mesref")}
            value={mergedTotalOutAmount}
            max={Math.max(mergedTotalInAmount, mergedTotalOutAmount, 1)}
            expense
          />
        </div>
        <div className="kasaReportSection kasaReportIncome">
          <div className="kasaReportSectionHead">
            <span>{tx(language, "Gelir", "Income", "Dahat")}</span>
            <strong>{moneyBreakdown(mergedTotalInByCurrency)}</strong>
          </div>
          <div className="kasaReportList">
            {mergedIncome.length === 0 ? (
              <p className="kasaReportEmpty">{tx(language, "Kayıt yok.", "No records.", "Qeyd tune.")}</p>
            ) : (
              mergedIncome.map(({ row: r, kasaName }) => (
                <div className="kasaReportRow" key={r.id}>
                  <span className="kasaReportRowDate">{date(r.date, language)}</span>
                  <span className="kasaReportRowTitle">
                    {localizeData(r.source, language)}
                    {isMulti && <small className="kasaReportRowKasa">▣ {localizeData(kasaName, language)}</small>}
                  </span>
                  <span className="kasaReportRowAmount">{money(r.amount, r.currency)}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="kasaReportSection kasaReportExpense">
          <div className="kasaReportSectionHead">
            <span>{tx(language, "Gider", "Expense", "Mesref")}</span>
            <strong>{moneyBreakdown(mergedTotalOutByCurrency)}</strong>
          </div>
          <div className="kasaReportList">
            {mergedExpense.length === 0 ? (
              <p className="kasaReportEmpty">{tx(language, "Kayıt yok.", "No records.", "Qeyd tune.")}</p>
            ) : (
              mergedExpense.map(({ row: r, kasaName }) => (
                <div className="kasaReportRow" key={r.id}>
                  <span className="kasaReportRowDate">{date(r.date, language)}</span>
                  <span className="kasaReportRowTitle">
                    {localizeData(r.source, language)}
                    {isMulti && <small className="kasaReportRowKasa">▣ {localizeData(kasaName, language)}</small>}
                  </span>
                  <span className="kasaReportRowAmount">{money(r.amount, r.currency)}</span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="kasaReportSummary">
          <div className="kasaReportSummaryRow kasaReportSummaryMain">
            <small>{tx(language, "KASA SONUÇ", "CASH RESULT", "ENCAMA QASEYÊ")}</small>
            <strong>{moneyBreakdown(mergedTotalByCurrency)}</strong>
          </div>
          <div className="kasaReportSummaryRow kasaReportSummaryIncome">
            <small>{tx(language, "TOPLAM GELİR", "TOTAL INCOME", "DAHATA GİŞTÎ")}</small>
            <strong>{moneyBreakdown(mergedTotalInByCurrency)}</strong>
          </div>
          <div className="kasaReportSummaryRow kasaReportSummaryExpense">
            <small>{tx(language, "TOPLAM GİDER", "TOTAL EXPENSE", "MESREFA GİŞTÎ")}</small>
            <strong>{moneyBreakdown(mergedTotalOutByCurrency)}</strong>
          </div>
          <div className="kasaReportSummaryRow kasaReportSummaryDate">
            <small>{tx(language, "TARİH", "DATE", "TARÎX")}</small>
            <strong>{reportDate}</strong>
          </div>
        </div>
        <div className="modalActions">
          <button type="button" className="light" onClick={onClose}>
            {tx(language, "Kapat", "Close", "Bigire")}
          </button>
          <button type="button" className="primary" onClick={exportToExcel}>
            ⇩ {tx(language, "Excel'e Aktar", "Export to Excel", "Derxe Excelê")}
          </button>
        </div>
      </div>
    </div>
  );
}
