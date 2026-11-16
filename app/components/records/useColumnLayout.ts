"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

// Kasalar/Gelir/Gider tablosunun sütunları — kullanıcı bunları sürükleyerek
// sırasını değiştirebilir ve kenarından tutup genişliğini ayarlayabilir
// (bkz. columnOrder/columnWidths in Records()). Tek bir liste hem sütun
// kimliklerini hem de varsayılan genişliklerini taşır; sırası
// DEFAULT_COLUMN_ORDER'ın başlangıç durumudur.
export type ColumnId = "date" | "title" | "workspace" | "documents" | "detail" | "messages" | "person" | "amount" | "location" | "tags" | "debt" | "action";
// Ana görünüm: Tarih, Kasa Adı, Çalışma Alanı, Kişi, Belgeler, Miktar, Etiket, İşlem. Detay/Not, Mesajlar ve Kasa Yeri ana tabloda yok.
const DEFAULT_COLUMN_ORDER: ColumnId[] = ["date", "title", "workspace", "person", "documents", "amount", "tags", "debt", "action"];
// Detay/Not ve Mesajlar öntanımlı olarak en dar iki sütun — uzun metin
// satıra sığmayınca satırı büyütmek yerine tek satırda "..." ile kesilir
// (bkz. renderCell'deki .cellDetailText ve .messagesCellText), böylece
// tablo hem dikeyde hem yatayda daha az yer kaplar. amount/action bilerek
// küçültülmedi — tutarların ve satır aksiyon ikonlarının kesilmemesi
// gerekiyor. Kullanıcı isterse sütun kenarından tutup yine genişletebilir.
const DEFAULT_COLUMN_WIDTHS: Record<ColumnId, number> = {
  date: 100,
  title: 170,
  workspace: 130,
  documents: 90,
  detail: 110,
  messages: 110,
  person: 80,
  amount: 110,
  location: 120,
  tags: 100,
  debt: 56,
  action: 104,
};
const MIN_COLUMN_WIDTH = 64;
// v2: Detay/Not ve Mesajlar öntanımlı genişlikleri daraltıldı — anahtar
// sürümü artırılmasa, daha önce kaydedilmiş (geniş) genişlikler yeni
// varsayılanları maskeler ve kullanıcı hiçbir fark görmez.
const COLUMNS_STORAGE_KEY = "mf-records-columns-v5";

// Records tablosunun sütun düzeni: sıra, genişlik, başlığı sürükleyerek taşıma ve kenarından boyutlandırma.
export function useColumnLayout() {
  // Sütun sırası ve genişlikleri — Kasalar/Gelir/Gider üçünde de aynı
  // sütun kimlikleri geçerli olduğu için tek, paylaşılan bir tercih olarak
  // saklanır (kind'a göre ayrı değil).
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(DEFAULT_COLUMN_ORDER);
  const [columnWidths, setColumnWidths] = useState<Record<ColumnId, number>>(DEFAULT_COLUMN_WIDTHS);
  const [columnsLoaded, setColumnsLoaded] = useState(false);
  const [draggedColumn, setDraggedColumn] = useState<ColumnId | null>(null);
  const resizingRef = useRef<{ id: ColumnId; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLUMNS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { order?: string[]; widths?: Partial<Record<ColumnId, number>> };
        if (Array.isArray(parsed.order)) {
          const valid = parsed.order.filter((id): id is ColumnId => (DEFAULT_COLUMN_ORDER as string[]).includes(id));
          const missing = DEFAULT_COLUMN_ORDER.filter((id) => !valid.includes(id));
          const merged = [...valid, ...missing];
          // Yeni "Borç" simge sütunu, kayıtlı sıralarda Etiket ile İşlem arasına konur.
          if ((missing as string[]).includes("debt")) {
            const without: ColumnId[] = merged.filter((id) => id !== "debt");
            const at = without.indexOf("action");
            without.splice(at < 0 ? without.length : at, 0, "debt");
            // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage yalnız tarayıcıda okunabilir; ilk render sunucu çıktısıyla aynı kalmalı (hydration)
            setColumnOrder(without);
          } else setColumnOrder(merged);
        }
        if (parsed.widths) setColumnWidths((w) => ({ ...w, ...parsed.widths }));
      }
    } catch {
      // Corrupt/unavailable storage — defaults stay in place.
    }
    setColumnsLoaded(true);
  }, []);

  useEffect(() => {
    if (!columnsLoaded) return;
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify({ order: columnOrder, widths: columnWidths }));
    } catch {
      // Quota or private-mode failure — the layout just won't survive reload.
    }
  }, [columnOrder, columnWidths, columnsLoaded]);

  function reorderColumn(draggedId: ColumnId, targetId: ColumnId) {
    setColumnOrder((order) => {
      const from = order.indexOf(draggedId);
      const to = order.indexOf(targetId);
      if (from === -1 || to === -1 || from === to) return order;
      const next = [...order];
      next.splice(from, 1);
      next.splice(to, 0, draggedId);
      return next;
    });
  }

  function onResizeMove(e: MouseEvent) {
    const r = resizingRef.current;
    if (!r) return;
    const next = Math.max(MIN_COLUMN_WIDTH, r.startWidth + (e.clientX - r.startX));
    setColumnWidths((w) => ({ ...w, [r.id]: next }));
  }
  function onResizeEnd() {
    resizingRef.current = null;
    window.removeEventListener("mousemove", onResizeMove);
    window.removeEventListener("mouseup", onResizeEnd);
  }
  function startResize(e: ReactMouseEvent, id: ColumnId) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { id, startX: e.clientX, startWidth: columnWidths[id] };
    window.addEventListener("mousemove", onResizeMove);
    window.addEventListener("mouseup", onResizeEnd);
  }

  return { columnOrder, columnWidths, draggedColumn, setDraggedColumn, reorderColumn, startResize };
}
