// exceljs (~1 MB) yalnız Excel dışa/içe aktarılırken yüklenir; ana sayfa
// paketine girmez. Tüm Excel üretimi/okuması bu yükleyiciyi kullanır.
export const loadExcelJS = async () => (await import("exceljs")).default;

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Yeni, boş bir çalışma kitabı (exceljs ihtiyaç anında yüklenir).
export async function newWorkbook() {
  const ExcelJS = await loadExcelJS();
  return new ExcelJS.Workbook();
}

// Çalışma kitabını .xlsx olarak indirir.
export async function downloadWorkbook(workbook: { xlsx: { writeBuffer: () => Promise<ArrayBuffer | Uint8Array> } }, filename: string): Promise<void> {
  const { downloadBlob } = await import("./download");
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer as BlobPart], { type: XLSX_MIME }), filename);
}
