import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessManagement, spreadsheetSafeText } from "./AccessManagement.js";

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

    render(<AccessManagement />);
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

    render(<AccessManagement />);
    const row = (await screen.findByText("Taylor Operator")).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "Remove Viewer access" }));
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
});
