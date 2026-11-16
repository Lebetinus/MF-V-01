// Uygulama içi bildirimler (eski alert() pencerelerinin yerine).
// notify() her yerden çağrılabilir; app/components/Toaster.tsx (layout'ta
// her ekranda bulunur) bunları ekranın köşesinde gösterir ve birkaç saniye
// sonra kaldırır. alert()'in aksine sayfayı kilitlemez.

export type NotifyKind = "error" | "success" | "info";
export type NotifyEvent = { id: number; message: string; kind: NotifyKind };

export const NOTIFY_EVENT = "mfv01:notify";
let nextId = 1;

export function notify(message: string, kind: NotifyKind = "error"): void {
  if (typeof window === "undefined" || !message) return;
  const detail: NotifyEvent = { id: nextId++, message, kind };
  window.dispatchEvent(new CustomEvent<NotifyEvent>(NOTIFY_EVENT, { detail }));
}
