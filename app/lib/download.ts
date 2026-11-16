// Tarayıcıda bir Blob'u dosya olarak indirir (gizli <a download> ile).
// Daha önce 5 bileşende ayrı ayrı kopyalanmış olan kodun ortak hali.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Bazı tarayıcılar indirmeyi tıklamadan hemen sonra başlatmaz; URL'yi biraz geç bırak.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
