// Kayıt/not eklerini tarayıcıda güvenle açmak için ortak yardımcılar.
//
// Ekler kullanıcıdan gelen data: URL'lerdir ve içindeki MIME türü de
// kullanıcının beyanıdır. Uygulamanın kendi origin'inde açılan bir blob,
// SVG/HTML gibi "aktif" bir türse içindeki script uygulamanın oturumuyla
// çalışır (stored XSS). Bu yüzden yalnız pasif türler (PDF ve raster
// resimler) yeni sekmede gösterilir; geri kalan her şey türü
// application/octet-stream'e zorlanarak indirilir.

const INLINE_SAFE_MIME = /^(application\/pdf|image\/(png|jpeg|gif|webp|bmp))$/i;

export function attachmentMime(data: string): string {
  const match = /^data:([^;,]*)/i.exec(data);
  return (match?.[1] || "application/octet-stream").trim().toLowerCase();
}

export function canOpenInline(mime: string): boolean {
  return INLINE_SAFE_MIME.test(mime);
}

function dataUrlBytes(data: string): Uint8Array {
  const comma = data.indexOf(",");
  const header = comma >= 0 ? data.slice(0, comma) : "";
  const body = comma >= 0 ? data.slice(comma + 1) : data;
  if (/;base64/i.test(header)) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new TextEncoder().encode(decodeURIComponent(body));
}

// Eki güvenli bir blob URL'sine çevirir. Satır içi açılamayan türlerde
// blob türü application/octet-stream olur, böylece tarayıcı onu asla
// sayfa olarak yorumlamaz.
export function attachmentBlobUrl(data: string): { url: string; inline: boolean } {
  const mime = attachmentMime(data);
  const inline = canOpenInline(mime);
  const blob = new Blob([dataUrlBytes(data) as BlobPart], { type: inline ? mime : "application/octet-stream" });
  return { url: URL.createObjectURL(blob), inline };
}

// PDF/resim yeni sekmede açılır, diğer her şey indirilir.
export function openAttachment(attachment: { name: string; data: string }, options: { forceDownload?: boolean } = {}): void {
  const { url, inline } = attachmentBlobUrl(attachment.data);
  const link = document.createElement("a");
  link.href = url;
  if (inline && !options.forceDownload) {
    link.target = "_blank";
    link.rel = "noopener";
  } else {
    link.download = attachment.name || "dosya";
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
