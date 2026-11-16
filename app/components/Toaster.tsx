"use client";

import { useEffect, useState } from "react";
import { NOTIFY_EVENT, type NotifyEvent } from "../lib/notify";

const VISIBLE_MS = { error: 7000, success: 4000, info: 5000 } as const;
const MAX_VISIBLE = 4;

// Renders notify() messages. Lives in the root layout so it is present on
// every screen (login included). aria-live makes screen readers announce them.
export function Toaster() {
  const [items, setItems] = useState<NotifyEvent[]>([]);

  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    const dismiss = (id: number) => {
      setItems((current) => current.filter((item) => item.id !== id));
      timers.delete(id);
    };
    const onNotify = (event: Event) => {
      const item = (event as CustomEvent<NotifyEvent>).detail;
      setItems((current) => {
        // The same message twice in a row (e.g. a retried save) shows once.
        if (current.some((c) => c.message === item.message && c.kind === item.kind)) return current;
        return [...current, item].slice(-MAX_VISIBLE);
      });
      timers.set(item.id, setTimeout(() => dismiss(item.id), VISIBLE_MS[item.kind]));
    };
    window.addEventListener(NOTIFY_EVENT, onNotify);
    return () => {
      window.removeEventListener(NOTIFY_EVENT, onNotify);
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  return (
    <div className="toastStack" aria-live="polite" aria-atomic="false">
      {items.map((item) => (
        <div key={item.id} className={`toast toast-${item.kind}`} role={item.kind === "error" ? "alert" : "status"}>
          <span className="toastIcon" aria-hidden="true">{item.kind === "error" ? "!" : item.kind === "success" ? "✓" : "i"}</span>
          <span className="toastText">{item.message}</span>
          <button
            type="button"
            className="toastClose"
            aria-label="Kapat"
            onClick={() => setItems((current) => current.filter((c) => c.id !== item.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
