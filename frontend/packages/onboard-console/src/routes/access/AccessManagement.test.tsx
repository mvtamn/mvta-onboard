import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { OnBoardAccessChangeRecord } from "@mvta/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDialogProvider } from "../../components/AppDialog.js";
import { AccessActivity } from "./AccessActivity.js";
import { AccessApprovals } from "./AccessApprovals.js";
import { AccessHealth } from "./AccessHealth.js";
import { AccessGroups, AccessPeople, AccessWorkloads } from "./AccessInventory.js";
import { AccessOverview } from "./AccessOverview.js";
import { AccessLayout } from "./AccessUi.js";
import { AddAccess } from "./AddAccess.js";
import { spreadsheetSafeText, withRoleLabels } from "./accessData.js";
import { actionLabel, outcomeOf } from "./auditVocabulary.js";

vi.mock("../../config.js", () => ({
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

vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: () => ({ account: { name: "Alex Administrator", username: "alex@mvta.com" }, roles: ["OCC.AccessAdmin"], signIn: vi.fn(), signOut: vi.fn() }),
}));

const { api } = await import("../../config.js");

function renderAt(path: string) {
  return render(<AppDialogProvider><MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/admin/access" element={<AccessLayout />}>
        <Route index element={<AccessOverview />} />
        <Route path="people" element={<AccessPeople />} />
        <Route path="groups" element={<AccessGroups />} />
        <Route path="workloads" element={<AccessWorkloads />} />
        <Route path="add" element={<AddAccess />} />
        <Route path="approvals" element={<AccessApprovals />} />
        <Route path="health" element={<AccessHealth />} />
        <Route path="activity" element={<AccessActivity />} />
      </Route>
    </Routes>
  </MemoryRouter></AppDialogProvider>);
}

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
      assignments: [{ role: "OCC.Viewer", source: "group", source_id: "group-1", source_name: "OnBoard Viewers" }],
      effective_roles: ["OCC.Viewer"],
    }, {
      id: "user-2",
      display_name: "Riley Direct",
      sign_in_name: "riley@mvta.com",
      principal_type: "user",
      account_enabled: false,
      guest_state: null,
      assignments: [{ role: "OCC.Compliance", source: "direct", source_id: "user-2", source_name: "Riley Direct", is_exception: true }],
      effective_roles: ["OCC.Compliance"],
    }, {
      id: "group-1",
      display_name: "OnBoard Viewers",
      sign_in_name: null,
      principal_type: "group",
      account_enabled: true,
      guest_state: null,
      assignments: [{ role: "OCC.Viewer", source: "direct", source_id: "group-1", source_name: "OnBoard Viewers" }],
      effective_roles: ["OCC.Viewer"],
    }, {
      id: "sp-1",
      display_name: "legacy-importer",
      sign_in_name: null,
      principal_type: "service_principal",
      account_enabled: true,
      guest_state: null,
      assignments: [{ role: "OCC.Viewer", source: "direct", source_id: "sp-1", source_name: "legacy-importer" }],
      effective_roles: ["OCC.Viewer"],
    }],
  });
  vi.mocked(api.getPendingAccessChanges).mockResolvedValue({ changes: [] });
  vi.mocked(api.getAccessExpirations).mockResolvedValue({ expirations: [] });
  vi.mocked(api.getAccessAudit).mockResolvedValue({ audit: [] });
});

afterEach(cleanup);

describe("Access & Identity vocabulary", () => {
  it("neutralizes spreadsheet formulas in exported directory text", () => {
    expect(spreadsheetSafeText("=HYPERLINK(\"https://evil.test\")")).toBe("'=HYPERLINK(\"https://evil.test\")");
    expect(spreadsheetSafeText("Taylor Operator")).toBe("Taylor Operator");
  });

  it("names roles by their label in API messages and audit codes by words", () => {
    expect(withRoleLabels("Configured group g-1 is not assigned to OCC.Detour on the app.")).toBe("Configured group g-1 is not assigned to Detour Manager on the app.");
    expect(actionLabel("privileged_change_requested")).toBe("Requested a privileged change");
    expect(actionLabel("something_new")).toBe("Something new");
    expect(outcomeOf("validation_failed").tone).toBe("bad");
  });
});

describe("Overview", () => {
  it("gathers what needs a decision from across the section", async () => {
    vi.mocked(api.getPendingAccessChanges).mockResolvedValue({ changes: [pendingChange({ requested_by_id: "actor-9", requested_by_name: "sam@mvta.com" })] });
    renderAt("/admin/access");

    expect(await screen.findByText("1 privileged request is waiting for approval")).toBeInTheDocument();
    expect(screen.getByText("1 person has access but a disabled or missing account")).toBeInTheDocument();
    expect(screen.getByText("1 person holds direct access")).toBeInTheDocument();
    expect(screen.getByText("1 holding a person’s role")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review approvals/ })).toHaveAttribute("href", "/admin/access/approvals");
  });
});

describe("People & guests", () => {
  it("shows effective access, and loads sign-ins for the selected person only when asked", async () => {
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
        events: [{ occurred_at: "2026-08-14T10:00:00Z", successful: true, client_app: "Browser", correlation_id: "signin-1" }],
      },
    });

    renderAt("/admin/access/people");
    const row = (await screen.findByRole("button", { name: "Taylor Operator" })).closest("tr")!;
    expect(within(row).getByText("Viewer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "OnBoard Viewers" })).not.toBeInTheDocument();

    await userEvent.click(within(row).getByRole("button", { name: "Taylor Operator" }));
    const detail = screen.getByRole("complementary", { name: "Access for Taylor Operator" });
    expect(within(detail).getByText("via OnBoard Viewers")).toBeInTheDocument();
    expect(api.getAccessSignIns).not.toHaveBeenCalled();

    await userEvent.click(within(detail).getByRole("button", { name: "View sign-ins" }));
    expect(await within(detail).findByText(/Directory-wide sign-in summary/)).toBeInTheDocument();
    expect(within(detail).getByText(/OnBoard-specific sign-in events/)).toBeInTheDocument();
    expect(within(detail).getByText(/not necessarily OnBoard/)).toBeInTheDocument();
    expect(within(detail).getByText("Successful · Browser")).toBeInTheDocument();
  });

  it("filters to direct access from a link", async () => {
    renderAt("/admin/access/people?show=direct");
    expect(await screen.findByRole("button", { name: "Riley Direct" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Taylor Operator" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Direct access" })).toHaveAttribute("aria-pressed", "true");
  });

  it("checks a removal from the exact group-derived source before it can be confirmed", async () => {
    vi.mocked(api.previewAccessChanges).mockResolvedValue({ environment: "test", valid: true, items: [{ index: 0, disposition: "immediate", errors: [] }] });
    vi.mocked(api.submitAccessChanges).mockResolvedValue({ environment: "test", results: [{ index: 0, disposition: "completed" }] });

    renderAt("/admin/access/people");
    await userEvent.click(await screen.findByRole("button", { name: "Taylor Operator" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove access: Viewer for Taylor Operator" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Viewer from Taylor Operator?" });
    expect(within(dialog).getByRole("button", { name: "Remove access" })).toBeDisabled();

    await userEvent.type(within(dialog).getByRole("textbox", { name: /Revocation reason/ }), "Moved to another team");
    expect(await within(dialog).findByText("Checked: this applies as soon as you confirm.", {}, { timeout: 2000 })).toBeInTheDocument();
    expect(api.previewAccessChanges).toHaveBeenLastCalledWith([{
      action: "revoke",
      principal_id: "user-1",
      principal_type: "user",
      role: "OCC.Viewer",
      source: "group",
      source_id: "group-1",
      reason: "Moved to another team",
    }]);

    await userEvent.click(within(dialog).getByRole("button", { name: "Remove access" }));
    expect(api.submitAccessChanges).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Viewer removed from Taylor Operator.")).toBeInTheDocument();
  });
});

describe("Access groups and Workloads", () => {
  it("keeps groups on their own page and labels their action clearly", async () => {
    renderAt("/admin/access/groups");
    const groupRow = (await screen.findByText("OnBoard Viewers")).closest("tr")!;
    expect(screen.getByRole("columnheader", { name: "Assigned OnBoard access" })).toBeInTheDocument();
    expect(within(groupRow).getByRole("button", { name: "Remove group assignment: Viewer for OnBoard Viewers" })).toBeInTheDocument();
    expect(within(groupRow).getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("Taylor Operator")).not.toBeInTheDocument();
  });

  it("flags a workload that holds a person's role", async () => {
    renderAt("/admin/access/workloads");
    const row = (await screen.findByText("legacy-importer")).closest("tr")!;
    expect(within(row).getByText("Holds a person’s role")).toBeInTheDocument();
  });
});

describe("Add access", () => {
  it("names each requested change and explains its approval state", async () => {
    vi.mocked(api.searchAccessDirectory).mockResolvedValue({ candidates: [{
      id: "user-3",
      display_name: "Morgan Manager",
      sign_in_name: "morgan@mvta.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [],
      effective_roles: [],
    }] });
    vi.mocked(api.previewAccessChanges).mockResolvedValue({ environment: "test", valid: true, items: [{ index: 0, disposition: "approval_required", errors: [] }] });
    vi.mocked(api.submitAccessChanges).mockResolvedValue({ environment: "test", results: [{ index: 0, disposition: "pending_approval" }] });

    renderAt("/admin/access/add");
    await userEvent.type(await screen.findByRole("searchbox", { name: "Search Entra directory" }), "Morgan");
    await userEvent.click(screen.getByRole("button", { name: "Search Entra" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /Morgan Manager/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Operations Administrator/ }));

    const summary = screen.getByRole("complementary", { name: "Review changes" });
    expect(within(summary).getByText("Grant Operations Administrator to Morgan Manager")).toBeInTheDocument();
    await userEvent.click(within(summary).getByRole("button", { name: "Check changes" }));
    expect(await within(summary).findByText("Needs a second approver")).toBeInTheDocument();

    await userEvent.click(within(summary).getByRole("button", { name: "Submit change" }));
    expect(await within(summary).findByText("Grant Operations Administrator — Awaiting approval from another Access Administrator.")).toBeInTheDocument();
  });

  it("clears a check when a step changes", async () => {
    vi.mocked(api.searchAccessDirectory).mockResolvedValue({ candidates: [{
      id: "user-3", display_name: "Morgan Manager", sign_in_name: "morgan@mvta.com", principal_type: "user",
      account_enabled: true, guest_state: null, assignments: [], effective_roles: [],
    }] });
    vi.mocked(api.previewAccessChanges).mockResolvedValue({ environment: "test", valid: true, items: [{ index: 0, disposition: "immediate", errors: [] }] });

    renderAt("/admin/access/add");
    await userEvent.type(await screen.findByRole("searchbox", { name: "Search Entra directory" }), "Morgan");
    await userEvent.click(screen.getByRole("button", { name: "Search Entra" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: /Morgan Manager/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Alert Publisher/ }));
    await userEvent.click(screen.getByRole("button", { name: "Check changes" }));
    expect(await screen.findByRole("button", { name: "Submit change" })).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: /Business reason/ }), "Cover");
    expect(screen.queryByRole("button", { name: "Submit change" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check changes" })).toBeEnabled();
  });
});

function pendingChange(overrides: Record<string, unknown> = {}): OnBoardAccessChangeRecord {
  return {
    id: "request-1",
    environment: "test",
    change: { action: "grant" as const, principal_id: "user-1", principal_type: "user" as const, role: "OCC.Admin" as const, source: "group" as const, reason: "Duty manager" },
    status: "pending" as const,
    requested_by_id: "actor-1",
    requested_by_name: "alex@mvta.com",
    requested_at: "2026-08-27T12:00:00Z",
    approval_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    decided_by_id: null,
    decided_by_name: null,
    decided_at: null,
    result: null,
    ...overrides,
  } as OnBoardAccessChangeRecord;
}

describe("Approvals", () => {
  it("does not offer a requester an approval action for their own change", async () => {
    vi.mocked(api.getPendingAccessChanges).mockResolvedValue({ changes: [pendingChange()] });
    renderAt("/admin/access/approvals");

    const card = await screen.findByRole("article", { name: "Grant Operations Administrator to Taylor Operator" });
    expect(within(card).getByText("Awaiting another Access Administrator")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Cancel request" })).toBeInTheDocument();
  });

  it("lets another administrator approve, and only reject an unverifiable request", async () => {
    vi.mocked(api.getPendingAccessChanges).mockResolvedValue({ changes: [
      pendingChange({ id: "request-2", requested_by_id: "actor-9", requested_by_name: "sam@mvta.com" }),
      pendingChange({ id: "request-3", requested_by_id: "unknown", requested_by_name: "unknown", change: { action: "revoke", principal_id: "user-2", principal_type: "user", role: "OCC.AccessAdmin", source: "group", reason: "Setup" } }),
    ] });
    vi.mocked(api.decideAccessChange).mockResolvedValue({} as never);
    renderAt("/admin/access/approvals");

    const other = await screen.findByRole("article", { name: "Grant Operations Administrator to Taylor Operator" });
    const legacy = screen.getByRole("article", { name: "Remove Access Administrator from Riley Direct" });
    expect(within(legacy).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(legacy).getByText("Can’t verify requester")).toBeInTheDocument();

    await userEvent.click(within(other).getByRole("button", { name: "Approve" }));
    expect(api.decideAccessChange).toHaveBeenCalledWith("request-2", "approved", expect.stringMatching(/^access-approved-/));
  });
});

describe("Access health", () => {
  it("reads Entra on first visit, speaks in role names, and checks selected repairs before confirming", async () => {
    const repair = { action: "grant" as const, principal_id: "group-9", principal_type: "group" as const, role: "OCC.Detour" as const, source: "direct" as const, reason: "Repair configured role-group assignment" };
    vi.mocked(api.getAccessReconciliation).mockResolvedValue({
      environment: "test",
      observed_at: "2026-09-16T14:00:00Z",
      findings: [
        { code: "missing_role_group_assignment", severity: "error", principal_id: "group-9", role: "OCC.Detour", message: "Configured group group-9 is not assigned to OCC.Detour on the OnBoard enterprise application.", repair_change: repair },
        { code: "direct_human_assignment", severity: "warning", principal_id: "user-2", role: "OCC.Compliance", message: "Riley Direct has direct OCC.Compliance access that requires documented exception metadata." },
      ],
    });
    vi.mocked(api.previewAccessChanges).mockResolvedValue({ environment: "test", valid: true, items: [{ index: 0, disposition: "immediate", errors: [] }] });
    vi.mocked(api.submitAccessChanges).mockResolvedValue({ environment: "test", results: [{ index: 0, disposition: "completed" }] });

    renderAt("/admin/access/health");
    expect(await screen.findByText("Configured group group-9 is not assigned to Detour Manager on the OnBoard enterprise application.")).toBeInTheDocument();
    expect(api.getAccessReconciliation).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Open in People & guests" })).toHaveAttribute("href", "/admin/access/people?show=direct");

    await userEvent.click(screen.getByRole("checkbox", { name: /Select repair/ }));
    await userEvent.click(screen.getByRole("button", { name: "Check selected repairs" }));
    expect(api.previewAccessChanges).toHaveBeenCalledWith([repair]);
    await userEvent.click(await screen.findByRole("button", { name: "Confirm selected repairs" }));
    expect(api.submitAccessChanges).toHaveBeenCalledWith([repair], expect.stringMatching(/^reconcile-/));
  });
});

describe("Activity log", () => {
  it("shows actions in words and narrows to failures", async () => {
    vi.mocked(api.getAccessAudit).mockResolvedValue({ audit: [
      { id: "a1", environment: "test", actor_id: "x", actor_name: "Priya Shah", action: "access_grant", target_id: "user-1", reason: "Cover", outcome: "completed", correlation_id: null, occurred_at: "2026-09-16T15:00:00Z" },
      { id: "a2", environment: "test", actor_id: "y", actor_name: "Sam Patel", action: "privileged_change_blocked", target_id: null, reason: null, outcome: "blocked", correlation_id: null, occurred_at: "2026-09-15T15:00:00Z" },
    ] });
    renderAt("/admin/access/activity");

    const granted = (await screen.findByRole("cell", { name: "Granted access" })).closest("tr")!;
    expect(within(granted).getByText("Taylor Operator")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Failed or blocked" }));
    expect(screen.queryByRole("cell", { name: "Granted access" })).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Blocked a privileged change" })).toBeInTheDocument();
  });
});
