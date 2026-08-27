import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessManagement, spreadsheetSafeText } from "./AccessManagement.js";
import { AppDialogProvider } from "../components/AppDialog.js";

vi.mock("../config.js", () => ({
  api: {
    getAccessPrincipals: vi.fn(),
    getPendingAccessChanges: vi.fn(),
    getAccessExpirations: vi.fn(),
    getAccessAudit: vi.fn(),
    getAccessSignIns: vi.fn(),
    searchAccessDirectory: vi.fn(),
    previewAccessChanges: vi.fn(),
    submitAccessChanges: vi.fn(),
    decideAccessChange: vi.fn(),
    cancelAccessChange: vi.fn(),
    applyAccessExpirations: vi.fn(),
    getAccessReconciliation: vi.fn(),
    exportAccessInventory: vi.fn(),
  },
}));

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({ account: { name: "Alex Administrator", username: "alex@mvta.com" }, roles: ["OCC.AccessAdmin"], signIn: vi.fn(), signOut: vi.fn() }),
}));

const { api } = await import("../config.js");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getAccessPrincipals).mockResolvedValue({
    environment: "test",
    access_admin_fallback: false,
    principals: [{
      id: "user-1",
      display_name: "Taylor Operator",
      sign_in_name: "taylor@mvta.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [{
        role: "OCC.Viewer",
        source: "group",
        source_id: "group-viewers",
        source_name: "OnBoard Viewers",
      }],
      effective_roles: ["OCC.Viewer"],
    }, {
      id: "group-1",
      display_name: "OnBoard Viewers",
      sign_in_name: null,
      principal_type: "group",
      account_enabled: true,
      guest_state: null,
      assignments: [{
        role: "OCC.Viewer",
        source: "direct",
        source_id: "group-1",
        source_name: "OnBoard Viewers",
      }],
      effective_roles: ["OCC.Viewer"],
    }],
  });
  vi.mocked(api.getPendingAccessChanges).mockResolvedValue({ changes: [] });
  vi.mocked(api.getAccessExpirations).mockResolvedValue({ expirations: [] });
  vi.mocked(api.getAccessAudit).mockResolvedValue({ audit: [] });
});

afterEach(cleanup);

describe("AccessManagement", () => {
  it("neutralizes spreadsheet formulas in exported directory text", () => {
    expect(spreadsheetSafeText("=HYPERLINK(\"https://evil.test\")")).toBe("'=HYPERLINK(\"https://evil.test\")");
    expect(spreadsheetSafeText("Taylor Operator")).toBe("Taylor Operator");
  });
  it("explains effective group access and labels both sign-in scopes", async () => {
    vi.mocked(api.getAccessSignIns).mockResolvedValue({
      directory_summary: {
        scope: "directory_wide",
        last_successful_at: "2026-08-14T10:00:00Z",
        last_interactive_attempt_at: "2026-08-14T10:00:00Z",
        last_noninteractive_at: "2026-08-14T11:30:00Z",
      },
      onboard_events: {
        scope: "onboard_application",
        queried_at: "2026-08-14T12:00:00Z",
        events: [{
          occurred_at: "2026-08-14T10:00:00Z",
          successful: true,
          client_app: "Browser",
          correlation_id: "signin-1",
        }],
      },
    });

    render(<AppDialogProvider><AccessManagement /></AppDialogProvider>);
    const row = (await screen.findByText("Taylor Operator")).closest("tr")!;
    expect(within(row).getByText("Viewer")).toBeInTheDocument();
    expect(within(row).getByText("via OnBoard Viewers")).toBeInTheDocument();

    await userEvent.click(within(row).getByRole("button", { name: "View sign-ins" }));

    expect(await screen.findByRole("heading", { name: "Directory-wide sign-in summary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OnBoard-specific sign-in events" })).toBeInTheDocument();
    expect(screen.getByText(/not necessarily OnBoard/)).toBeInTheDocument();
    expect(screen.getByText("Successful · Browser")).toBeInTheDocument();
  });

  it("previews removal from the exact group-derived access source", async () => {
    vi.mocked(api.previewAccessChanges).mockResolvedValue({
      environment: "test",
      valid: true,
      items: [{ index: 0, disposition: "immediate", errors: [] }],
    });

    render(<AppDialogProvider><AccessManagement /></AppDialogProvider>);
    const row = (await screen.findByText("Taylor Operator")).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "Remove access: Viewer for Taylor Operator" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Revocation reason" }), "Moved to another team");
    await userEvent.click(screen.getByRole("button", { name: "Preview revocation" }));

    expect(api.previewAccessChanges).toHaveBeenCalledWith([{
      action: "revoke",
      principal_id: "user-1",
      principal_type: "user",
      role: "OCC.Viewer",
      source: "group",
      source_id: "group-viewers",
      reason: "Moved to another team",
    }]);
    expect(await screen.findByText("This change applies immediately after confirmation.")).toBeInTheDocument();
  });

  it("keeps access groups out of the people inventory and labels their action clearly", async () => {
    render(<AppDialogProvider><AccessManagement /></AppDialogProvider>);

    await screen.findByText("Taylor Operator");
    expect(screen.queryByText("OnBoard Viewers")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Filter guest status" }), "guest");
    await userEvent.click(screen.getByRole("tab", { name: "Access groups" }));
    const groupRow = (await screen.findByText("OnBoard Viewers")).closest("tr")!;
    expect(screen.getByRole("columnheader", { name: "Assigned OnBoard access" })).toBeInTheDocument();
    expect(within(groupRow).getByRole("button", { name: "Remove group assignment: Viewer for OnBoard Viewers" })).toBeInTheDocument();
  });

  it("names each requested role and explains its approval state", async () => {
    vi.mocked(api.searchAccessDirectory).mockResolvedValue({ candidates: [{
      id: "user-2",
      display_name: "Morgan Manager",
      sign_in_name: "morgan@mvta.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [],
      effective_roles: [],
    }] });
    vi.mocked(api.previewAccessChanges).mockResolvedValue({
      environment: "test",
      valid: true,
      items: [{ index: 0, disposition: "approval_required", errors: [] }],
    });
    vi.mocked(api.submitAccessChanges).mockResolvedValue({
      environment: "test",
      results: [{ index: 0, disposition: "pending_approval" }],
    });

    render(<AppDialogProvider><AccessManagement /></AppDialogProvider>);
    await userEvent.click(await screen.findByRole("tab", { name: "Add access" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search Entra directory" }), "Morgan");
    await userEvent.click(screen.getByRole("button", { name: "Search Entra" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /Morgan Manager/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Operations Administrator" }));
    await userEvent.click(screen.getByRole("button", { name: "Review changes" }));

    expect(await screen.findByText("Grant Operations Administrator — Requires approval from another Access Administrator.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm changes" }));
    expect(await screen.findByText("Grant Operations Administrator — Awaiting approval from another Access Administrator.")).toBeInTheDocument();
  });

  it("does not offer a requester an approval action for their own change", async () => {
    vi.mocked(api.getPendingAccessChanges).mockResolvedValue({ changes: [{
      id: "request-1",
      environment: "test",
      change: {
        action: "grant",
        principal_id: "user-2",
        principal_type: "user",
        role: "OCC.Admin",
        source: "group",
        reason: "Duty manager",
      },
      status: "pending",
      requested_by_id: "actor-1",
      requested_by_name: "alex@mvta.com",
      requested_at: "2026-08-27T12:00:00Z",
      approval_expires_at: "2026-08-28T12:00:00Z",
      decided_by_id: null,
      decided_by_name: null,
      decided_at: null,
      result: null,
    }] });

    render(<AppDialogProvider><AccessManagement /></AppDialogProvider>);
    await userEvent.click(await screen.findByRole("tab", { name: "Approval requests (1)" }));

    expect(screen.getByText("Awaiting another Access Administrator")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel request" })).toBeInTheDocument();
  });
});
