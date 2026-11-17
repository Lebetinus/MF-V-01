"use client";

import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { RecordItem, RecordsView } from "../../lib/types";

// Tarihe göre / son eklenene göre sıralama — standart bir liste özelliği.
// Seçim değişince önceki elle sürükleme sırası (rowOrder) temizlenir, yoksa
// yeni seçim görünürde hiçbir şey değiştirmemiş gibi durur.
export type SortMode = "dateDesc" | "dateAsc" | "addedDesc" | "addedAsc";

// Satır sırası tercihleri (sayfa türüne göre localStorage'da): elle sürükleme sırası ve sıralama seçimi.
export function useRowOrder(kind: RecordsView) {
  // Manual row order (drag handle in the İşlem column) — a per-kind override
  // on top of the default date/id sort, kept in localStorage since it's a
  // personal display preference, not app data. Ids not in the saved order
  // (new records) fall back to their normal sorted position, after the ones
  // the user has placed.
  const [rowOrder, setRowOrder] = useState<number[]>([]);
  const [draggedRowId, setDraggedRowId] = useState<number | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<number | null>(null);
  const rowOrderStorageKey = `mf-row-order-${kind}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(rowOrderStorageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage yalnız tarayıcıda okunabilir; ilk render sunucu çıktısıyla aynı kalmalı (hydration)
      setRowOrder(saved ? JSON.parse(saved) : []);
    } catch {
      setRowOrder([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  function persistRowOrder(order: number[]) {
    setRowOrder(order);
    try {
      localStorage.setItem(rowOrderStorageKey, JSON.stringify(order));
    } catch {
      // Quota or private-mode failure — the order just won't survive reload.
    }
  }
  const [sortMode, setSortMode] = useState<SortMode>("dateDesc");
  const sortModeStorageKey = `mf-sort-mode-${kind}`;
  useEffect(() => {
    try {
      const saved = localStorage.getItem(sortModeStorageKey) as SortMode | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage yalnız tarayıcıda okunabilir; ilk render sunucu çıktısıyla aynı kalmalı (hydration)
      setSortMode(saved && ["dateDesc", "dateAsc", "addedDesc", "addedAsc"].includes(saved) ? saved : "dateDesc");
    } catch {
      setSortMode("dateDesc");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  function changeSortMode(next: SortMode) {
    setSortMode(next);
    try {
      localStorage.setItem(sortModeStorageKey, next);
    } catch {
      // Quota or private-mode failure — the choice just won't survive reload.
    }
    persistRowOrder([]);
  }

  return { rowOrder, draggedRowId, setDraggedRowId, dragOverRowId, setDragOverRowId, persistRowOrder, sortMode, changeSortMode };
}

// Görünen satırlar: önce sıralama seçimine (sortMode), sonra varsa elle sürükleme sırasına (rowOrder) göre dizilir.
export function useOrderedRows(rows: RecordItem[], sortMode: SortMode, rowOrder: number[]) {
  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      switch (sortMode) {
        case "dateAsc":
          return a.date.localeCompare(b.date) || a.id - b.id;
        case "addedAsc":
          return a.id - b.id;
        case "addedDesc":
          return b.id - a.id;
        case "dateDesc":
        default:
          return b.date.localeCompare(a.date) || b.id - a.id;
      }
    });
    return copy;
  }, [rows, sortMode]);
  const orderedRows = useMemo(() => {
    if (!rowOrder.length) return sortedRows;
    const index = new Map(rowOrder.map((id, i) => [id, i]));
    return [...sortedRows].sort((a, b) => {
      const ai = index.has(a.id) ? index.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const bi = index.has(b.id) ? index.get(b.id)! : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }, [sortedRows, rowOrder]);
  return orderedRows;
}

// Satır sürükleme — native HTML5 drag-and-drop (draggable + onDragStart/
// onDrop) tablo satırlarında (<tr>) tarayıcılar arasında güvenilir çalışmadığı
// için (sürükleme hiç başlamayabiliyor), fare olaylarıyla elle takip edilen
// aynı yöntem kullanılıyor — bkz. shared.tsx'teki useDraggableModals.
// Records her render'da bu fonksiyonu o render'ın orderedRows'u ile çağırır; sürükleme, başladığı andaki sırayı kullanır.
export function createRowDrag(
  orderedRows: RecordItem[],
  persistRowOrder: (order: number[]) => void,
  setDraggedRowId: (id: number | null) => void,
  setDragOverRowId: (id: number | null) => void,
) {
  function startRowDrag(e: ReactMouseEvent, id: number) {
    e.preventDefault();
    setDraggedRowId(id);
    document.body.classList.add("noSelectDragging");
    function onMove(ev: MouseEvent) {
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const rowEl = el?.closest("tr[data-row-id]") as HTMLElement | null;
      setDragOverRowId(rowEl ? Number(rowEl.dataset.rowId) : null);
    }
    function onUp(ev: MouseEvent) {
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const rowEl = el?.closest("tr[data-row-id]") as HTMLElement | null;
      const targetId = rowEl ? Number(rowEl.dataset.rowId) : null;
      if (targetId !== null) moveRow(id, targetId);
      setDraggedRowId(null);
      setDragOverRowId(null);
      document.body.classList.remove("noSelectDragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }
  function moveRow(draggedId: number, targetId: number) {
    if (draggedId === targetId) return;
    const currentIds = orderedRows.map((r) => r.id);
    const from = currentIds.indexOf(draggedId);
    const to = currentIds.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const next = [...currentIds];
    next.splice(from, 1);
    next.splice(to, 0, draggedId);
    persistRowOrder(next);
  }
  return { startRowDrag, moveRow };
}
