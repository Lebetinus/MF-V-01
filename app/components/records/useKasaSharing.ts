"use client";

import { useState } from "react";
import { tx } from "../../lib/i18n";
import type { CashAccountSummary, Language } from "../../lib/types";
import { notify } from "../../lib/notify";

// "Kasayı Paylaş" penceresinin sunucu işlemleri: kullanıcıya erişim verme/kaldırma ve pano paylaşımı.
export function useKasaSharing({
  language,
  shareTarget,
  setShareTarget,
  onCashAccountsChange,
}: {
  language: Language;
  shareTarget: CashAccountSummary | null;
  setShareTarget: (account: CashAccountSummary) => void;
  onCashAccountsChange: (updater: CashAccountSummary[] | ((current: CashAccountSummary[]) => CashAccountSummary[])) => void;
}) {
  const [shareBusyKey, setShareBusyKey] = useState<string | null>(null);
  const [dashboardShareBusy, setDashboardShareBusy] = useState(false);

  async function toggleShare(userId: number, grant: boolean) {
    if (!shareTarget) return;
    const cashAccountId = shareTarget.id;
    const key = `${cashAccountId}-${userId}`;
    setShareBusyKey(key);
    try {
      const response = grant
        ? await fetch(`/api/cash-accounts/${cashAccountId}/access`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
          })
        : await fetch(`/api/cash-accounts/${cashAccountId}/access?userId=${userId}`, { method: "DELETE" });
      if (!response.ok) {
        notify(tx(language, "İşlem tamamlanamadı.", "The operation could not be completed.", "Kirin nehat qedandin."));
        return;
      }
      // Built from `shareTarget` itself (not the `cashAccounts` prop, which
      // may be scoped to just the active workspace) so this patches the
      // right row in the full list regardless of what's currently filtered.
      const updatedTarget: CashAccountSummary = {
        ...shareTarget,
        sharedWithUserIds: grant
          ? [...shareTarget.sharedWithUserIds, userId]
          : shareTarget.sharedWithUserIds.filter((id) => id !== userId),
      };
      onCashAccountsChange((current) => current.map((a) => (a.id === cashAccountId ? updatedTarget : a)));
      setShareTarget(updatedTarget);
    } catch {
      notify(tx(language, "İşlem tamamlanamadı.", "The operation could not be completed.", "Kirin nehat qedandin."));
    } finally {
      setShareBusyKey(null);
    }
  }

  async function toggleDashboardShare(enabled: boolean) {
    if (!shareTarget) return;
    const cashAccountId = shareTarget.id;
    setDashboardShareBusy(true);
    try {
      const response = await fetch(`/api/cash-accounts/${cashAccountId}/dashboard-share`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        notify(tx(language, "İşlem tamamlanamadı.", "The operation could not be completed.", "Kirin nehat qedandin."));
        return;
      }
      const updatedTarget: CashAccountSummary = { ...shareTarget, dashboardShareEnabled: enabled };
      onCashAccountsChange((current) => current.map((a) => (a.id === cashAccountId ? updatedTarget : a)));
      setShareTarget(updatedTarget);
    } catch {
      notify(tx(language, "İşlem tamamlanamadı.", "The operation could not be completed.", "Kirin nehat qedandin."));
    } finally {
      setDashboardShareBusy(false);
    }
  }

  return { shareBusyKey, dashboardShareBusy, toggleShare, toggleDashboardShare };
}

// Bekleyen kasa aktarımının (Gelir/Gider satırındaki ✓) onaylanması.
export function useTransferApproval({ language, onTransfersChanged }: { language: Language; onTransfersChanged: () => void }) {
  const [approvingId, setApprovingId] = useState<number | null>(null);

  async function approveTransfer(transferId: number) {
    setApprovingId(transferId);
    try {
      const response = await fetch(`/api/cash-transfers/${transferId}/confirm`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        notify(body.error || tx(language, "Aktarım onaylanamadı.", "The transfer could not be confirmed.", "Veguhastin nehat erêkirin."));
        return;
      }
      onTransfersChanged();
    } catch {
      notify(tx(language, "Aktarım onaylanamadı.", "The transfer could not be confirmed.", "Veguhastin nehat erêkirin."));
    } finally {
      setApprovingId(null);
    }
  }

  return { approvingId, approveTransfer };
}
