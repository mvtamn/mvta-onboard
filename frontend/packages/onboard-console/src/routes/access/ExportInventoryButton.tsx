import { api } from "../../config.js";
import { Icon } from "./AccessUi.js";
import { errorMessage, spreadsheetSafeText, useAccess } from "./accessData.js";

// Exports the Entra sign-in inventory - people, groups and workloads - which is
// who may sign in, not what they may do: OnBoard roles are granted in People &
// identity and are not in this file (ADR-0032).
// Whichever page
// it is pressed on. The export is itself recorded in the administrative audit.
export function ExportInventoryButton() {
  const { busy, setBusy, setError, setNotice } = useAccess();

  async function exportInventory() {
    const quote = (value: unknown) => `"${spreadsheetSafeText(value).replaceAll('"', '""')}"`;
    setBusy(true);
    try {
      const exportData = await api.exportAccessInventory();
      const rows = exportData.rows.map((row) => [
        row.display_name, row.sign_in_name, row.principal_type, row.account_enabled,
        row.guest_state, row.effective_roles.join("; "), row.role, row.source, row.source_name, row.sponsor,
        row.organization, row.expires_at, row.reconciliation_status, exportData.environment,
      ]);
      const csv = [
        ["Name", "Sign-in name", "Principal type", "Account enabled", "Guest state", "Effective roles", "Role", "Source", "Source name", "Sponsor", "Organization", "Expiry", "Reconciliation", "Environment"],
        ...rows,
      ].map((row) => row.map(quote).join(",")).join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `onboard-access-${exportData.environment}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("Access inventory exported and recorded in the activity log.");
    } catch (exportError) {
      setError(errorMessage(exportError, "Access inventory export failed."));
    } finally {
      setBusy(false);
    }
  }

  return <button type="button" className="am-btn" disabled={busy} onClick={() => void exportInventory()}><Icon name="download" />Export Entra inventory</button>;
}
