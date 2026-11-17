import type { CashTransfer, RecordItem } from "./types";

// Kasa aktarımının iki kaydı (gönderende X "gider", alanda X "gelir"; ikisi de "Kasa Aktarımı")
// paranın kasalar arasında yer değiştirmesidir; yeni gelir veya gider
// değildir. Kasa bakiyelerine girerler ama gelir/gider/net toplamlarına ve
// analize girmezler (borç kayıtlarındaki isDebtLeg ile aynı mantık).
export function transferLegIds(cashTransfers: Pick<CashTransfer, "fromRecordId" | "toRecordId" | "status">[]): Set<number> {
  const ids = new Set<number>();
  for (const t of cashTransfers) {
    if (t.status === "cancelled") continue;
    if (t.fromRecordId != null) ids.add(t.fromRecordId);
    if (t.toRecordId != null) ids.add(t.toRecordId);
  }
  return ids;
}

export function makeIsTransferLeg(cashTransfers: Pick<CashTransfer, "fromRecordId" | "toRecordId" | "status">[]): (x: Pick<RecordItem, "id">) => boolean {
  const ids = transferLegIds(cashTransfers);
  return (x) => ids.has(x.id);
}
