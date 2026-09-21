import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError, type AccessGrantRequestView, type AccessPersonView, type AccessRoleView } from "@mvta/shared";
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
    // OnBoard's own roles and grants (ADR-0032).
    getAccessPeople: vi.fn(),
    getAccessGrantRequests: vi.fn(),
    getAccessRoles: vi.fn(),
    addAccessPerson: vi.fn(),
    grantAccessRole: vi.fn(),
    revokeAccessGrant: vi.fn(),
    decideAccessGrantRequest: vi.fn(),
    importAccessFromEntra: vi.fn(),
    getAccessHealthFindings: vi.fn(),
    getAccessActivity: vi.fn(),
    // The three things Entra is still asked.
    searchAccessDirectory: vi.fn(),
    getAccessSignIns: vi.fn(),
    previewAccessChanges: vi.fn(),
    submitAccessChanges: vi.fn(),
    // The Entra inventory, still read for groups, workloads and the import.
    getAccessPrincipals: vi.fn(),
    getAccessAudit: vi.fn(),
    exportAccessInventory: vi.fn(),
  },
}));

vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: () => ({ account: { id: "actor-1", name: "Alex Administrator", username: "alex@example.com" }, signIn: vi.fn(), signOut: vi.fn() }),
}));

vi.mock("../../auth/AccessContext.js", async () => {
  const actual = await vi.importActual<typeof import("../../auth/AccessContext.js")>("../../auth/AccessContext.js");
  return { ...actual, useAccess: () => actual.accessStateWith(["access-identity.view", "access-identity.manage", "access-identity.approve"]) };
});

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

function role(overrides: Partial<AccessRoleView> & { key: string; name: string }): AccessRoleView {
  return {
    purpose: "",
    locked: false,
    allActions: false,
    actions: [],
    summary: [],
    members: 0,
    seeded: true,
    archived: false,
    ...overrides,
  };
}

const VIEWER = role({
  key: "viewer",
  name: "Viewer",
  purpose: "Read-only cover for the dispatch desk.",
  actions: ["dashboard.view"],
  summary: ["Dashboard: view only"],
  members: 1,
});

const ACCESS_ADMIN = role({
  key: "access-administrator",
  name: "Access Administrator",
  locked: true,
  actions: ["access-identity.view", "access-identity.manage", "access-identity.approve"],
  summary: ["Access & Identity: view; grant access and edit roles"],
  members: 1,
});

function person(overrides: Partial<AccessPersonView> & { personId: string; objectId: string }): AccessPersonView {
  return {
    tenantId: "tenant-1",
    name: null,
    email: null,
    kind: "member",
    status: "active",
    sponsorName: null,
    organization: null,
    justification: null,
    importedFrom: null,
    lastSeenAt: null,
    roles: [],
    actions: [],
    summary: [],
    ...overrides,
  };
}

const TAYLOR = person({
  personId: "person-1",
  objectId: "user-1",
  name: "Taylor Operator",
  email: "taylor@example.com",
  lastSeenAt: new Date(Date.now() - 3_600_000).toISOString(),
  roles: [{ grantId: "grant-1", roleKey: "viewer", roleName: "Viewer", grantedAt: "2026-09-01T12:00:00Z", grantedBy: "Alex Administrator", approvedBy: null, expiresAt: null }],
  actions: ["dashboard.view"],
  summary: ["Dashboard: view only"],
});

const RILEY = person({
  personId: "person-2",
  objectId: "user-2",
  name: "Riley Guest",
  email: "riley@example.com",
  kind: "guest",
  sponsorName: "Alex Administrator",
  organization: "Contoso Transit",
  justification: "Detour planning review",
});

function grantRequest(overrides: Partial<AccessGrantRequestView> = {}): AccessGrantRequestView {
  return {
    requestId: "request-1",
    personId: "person-1",
    personName: "Taylor Operator",
    personEmail: "taylor@example.com",
    roleKey: "access-administrator",
    roleName: "Access Administrator",
    action: "grant",
    reason: "Duty manager",
    expiresAt: null,
    status: "pending",
    requestedByObjectId: "actor-1",
    requestedByName: "alex@example.com",
    requestedAt: "2026-09-16T12:00:00Z",
    approvalExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    decidedByName: null,
    decidedAt: null,
    decisionReason: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getAccessPeople).mockResolvedValue({ people: [TAYLOR, RILEY] });
  vi.mocked(api.getAccessGrantRequests).mockResolvedValue({ requests: [] });
  vi.mocked(api.getAccessRoles).mockResolvedValue({ roles: [VIEWER, ACCESS_ADMIN] });
  vi.mocked(api.getAccessAudit).mockResolvedValue({ audit: [] });
  vi.mocked(api.getAccessActivity).mockResolvedValue({ activity: [] });
  vi.mocked(api.addAccessPerson).mockResolvedValue({ personId: "person-new", created: true });
  vi.mocked(api.getAccessPrincipals).mockResolvedValue({
    environment: "test",
    access_admin_fallback: false,
    principals: [{
      id: "user-1",
      display_name: "Taylor Operator",
      sign_in_name: "taylor@example.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [{ role: "OCC.Viewer", source: "group", source_id: "group-1", source_name: "OnBoard Viewers" }],
      effective_roles: ["OCC.Viewer"],
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
});

afterEach(cleanup);

describe("Access & Identity vocabulary", () => {
  it("neutralizes spreadsheet formulas in exported directory text", () => {
    expect(spreadsheetSafeText("=HYPERLINK(\"https://evil.test\")")).toBe("'=HYPERLINK(\"https://evil.test\")");
    expect(spreadsheetSafeText("Taylor Operator")).toBe("Taylor Operator");
  });

  it("names Entra roles by their label in API messages and audit codes by words", () => {
    expect(withRoleLabels("Configured group g-1 is not assigned to OCC.Detour on the app.")).toBe("Configured group g-1 is not assigned to Detour Manager on the app.");
    expect(actionLabel("privileged_change_requested")).toBe("Requested a privileged change");
    expect(actionLabel("something_new")).toBe("Something new");
    expect(outcomeOf("validation_failed").tone).toBe("bad");
  });
});

describe("Setup", () => {
  it("reads a 503 as an environment that has not been migrated, not as a failure", async () => {
    vi.mocked(api.getAccessPeople).mockRejectedValue(new ApiError(503, "Roles are not set up in this environment yet."));
    vi.mocked(api.getAccessGrantRequests).mockRejectedValue(new ApiError(503, "Roles are not set up in this environment yet."));
    vi.mocked(api.getAccessRoles).mockRejectedValue(new ApiError(503, "Roles are not set up in this environment yet."));

    renderAt("/admin/access/people");
    expect(await screen.findByText(/OnBoard’s roles are not set up in this environment yet/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Overview", () => {
  it("still renders when a list comes back without its field", async () => {
    // A payload missing `audit` used to reach the page as undefined and crash
    // it, which reads as OnBoard being broken rather than as one list that
    // could not be read.
    vi.mocked(api.getAccessAudit).mockResolvedValue({} as never);
    renderAt("/admin/access");
    expect(await screen.findByText("1 person holds no role")).toBeInTheDocument();
  });

  it("counts from OnBoard's own grants and gathers what needs a decision", async () => {
    vi.mocked(api.getAccessGrantRequests).mockResolvedValue({ requests: [grantRequest({ requestedByObjectId: "actor-9", requestedByName: "sam@example.com" })] });
    renderAt("/admin/access");

    expect(await screen.findByText("1 privileged request is waiting for approval")).toBeInTheDocument();
    expect(screen.getByText("1 person holds no role")).toBeInTheDocument();
    expect(screen.getByText("1 guest · 1 holding no role")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review approvals/ })).toHaveAttribute("href", "/admin/access/approvals");
    // Roles, with what each allows, replace the Entra access levels table.
    const rolesTable = screen.getByRole("table");
    expect(within(rolesTable).getByText("Dashboard: view only")).toBeInTheDocument();
  });

  it("imports today's Entra assignments once, and says what it did", async () => {
    vi.mocked(api.importAccessFromEntra).mockResolvedValue({ people: 1, granted: 1, skipped: 0, unknownRoles: [] });
    renderAt("/admin/access");

    await userEvent.click(await screen.findByRole("button", { name: "Import from Entra" }));
    // Only people are imported: a group or workload assignment grants nobody a role.
    expect(api.importAccessFromEntra).toHaveBeenCalledWith([{
      object_id: "user-1",
      name: "Taylor Operator",
      email: "taylor@example.com",
      app_role: "OCC.Viewer",
      via: "group OnBoard Viewers",
    }]);
    expect(await screen.findByText("1 read from Entra · 1 person, 1 grant, 0 skipped.")).toBeInTheDocument();
    // Pressing it refreshes what the section holds, so a second press is honest.
    expect(api.getAccessPeople).toHaveBeenCalledTimes(2);
  });

  // Finding nothing used to be one sentence blaming Entra, which on dev was
  // wrong: Entra held 24 assignments and the read had gone wrong instead. Each
  // way of finding nothing now says which one it was, and none of them posts.
  it("says Entra returned nothing when the app roles asked about do not match", async () => {
    vi.mocked(api.getAccessPrincipals).mockResolvedValue({ environment: "test", principals: [] } as never);
    renderAt("/admin/access");

    await userEvent.click(await screen.findByRole("button", { name: "Import from Entra" }));
    expect(await screen.findByText(/ONBOARD_ACCESS_CONFIG_JSON/)).toBeInTheDocument();
    expect(api.importAccessFromEntra).not.toHaveBeenCalled();
  });

  it("names the unread group membership when Entra returns groups and no people", async () => {
    vi.mocked(api.getAccessPrincipals).mockResolvedValue({
      environment: "test",
      principals: [{
        id: "group-1",
        display_name: "OnBoard Viewers",
        sign_in_name: null,
        principal_type: "group",
        account_enabled: null,
        guest_state: null,
        assignments: [{ role: "OCC.Viewer", source: "direct", source_id: "a-1", source_name: "Enterprise application assignment" }],
        effective_roles: ["OCC.Viewer"],
      }],
    } as never);
    renderAt("/admin/access");

    await userEvent.click(await screen.findByRole("button", { name: "Import from Entra" }));
    expect(await screen.findByText(/1 group and no people/)).toBeInTheDocument();
    expect(await screen.findByText(/directory read permission/)).toBeInTheDocument();
    expect(api.importAccessFromEntra).not.toHaveBeenCalled();
  });
});

describe("People & guests", () => {
  it("shows the roles held, the generated summary and guest details, and loads sign-ins only when asked", async () => {
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
    // A grant names a person; there is no "via" group to report any more.
    expect(within(row).queryByText(/via /)).not.toBeInTheDocument();

    await userEvent.click(within(row).getByRole("button", { name: "Taylor Operator" }));
    const detail = screen.getByRole("complementary", { name: "Access for Taylor Operator" });
    expect(within(detail).getByText("Dashboard: view only")).toBeInTheDocument();
    expect(within(detail).getByText(/Granted .* by Alex Administrator/)).toBeInTheDocument();
    expect(api.getAccessSignIns).not.toHaveBeenCalled();

    await userEvent.click(within(detail).getByRole("button", { name: "View sign-ins" }));
    expect(api.getAccessSignIns).toHaveBeenCalledWith("user-1");
    expect(await within(detail).findByText(/Directory-wide sign-in summary/)).toBeInTheDocument();
    expect(within(detail).getByText("Successful · Browser")).toBeInTheDocument();
  });

  it("shows a guest's sponsor and organization on their own record", async () => {
    renderAt("/admin/access/people");
    await userEvent.click(await screen.findByRole("button", { name: "Riley Guest" }));
    const detail = screen.getByRole("complementary", { name: "Access for Riley Guest" });
    expect(within(detail).getByText("Contoso Transit")).toBeInTheDocument();
    expect(within(detail).getByText("Alex Administrator")).toBeInTheDocument();
    expect(within(detail).getByText(/Holds no role, so OnBoard shows them the No access page/)).toBeInTheDocument();
  });

  it("filters to the people holding nothing from a link", async () => {
    renderAt("/admin/access/people?show=nothing");
    expect(await screen.findByRole("button", { name: "Riley Guest" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Taylor Operator" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Holds no role" })).toHaveAttribute("aria-pressed", "true");
  });

  it("revokes one grant by its id, with a reason", async () => {
    vi.mocked(api.revokeAccessGrant).mockResolvedValue({ disposition: "applied", grantId: "grant-1" });

    renderAt("/admin/access/people");
    await userEvent.click(await screen.findByRole("button", { name: "Taylor Operator" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove access: Viewer for Taylor Operator" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Viewer from Taylor Operator?" });
    expect(within(dialog).getByRole("button", { name: "Remove access" })).toBeDisabled();

    await userEvent.type(within(dialog).getByRole("textbox", { name: /Revocation reason/ }), "Moved to another team");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove access" }));
    // The third argument is the step-up: an ordinary role does not need one.
    expect(api.revokeAccessGrant).toHaveBeenCalledWith("grant-1", "Moved to another team", false);
    expect(await screen.findByText("Viewer removed from Taylor Operator.")).toBeInTheDocument();
  });

  it("reads a privileged removal as waiting for a second Access Administrator", async () => {
    vi.mocked(api.getAccessPeople).mockResolvedValue({ people: [{
      ...TAYLOR,
      roles: [{ grantId: "grant-9", roleKey: "access-administrator", roleName: "Access Administrator", grantedAt: "2026-09-01T12:00:00Z", grantedBy: null, approvedBy: "Sam Patel", expiresAt: null }],
    }] });
    vi.mocked(api.revokeAccessGrant).mockResolvedValue({ disposition: "pending_approval", requestId: "request-7" });

    renderAt("/admin/access/people");
    await userEvent.click(await screen.findByRole("button", { name: "Taylor Operator" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove access: Access Administrator for Taylor Operator" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Access Administrator from Taylor Operator?" });
    expect(within(dialog).getByText(/a second Access Administrator decides it/)).toBeInTheDocument();

    await userEvent.type(within(dialog).getByRole("textbox", { name: /Revocation reason/ }), "Left the team");
    await userEvent.click(within(dialog).getByRole("button", { name: "Request removal" }));
    expect(await screen.findByText("Removing Access Administrator from Taylor Operator is waiting for a second Access Administrator.")).toBeInTheDocument();
    // The step-up matters: without it the server refuses the change outright
    // instead of opening the request a second administrator can decide.
    expect(api.revokeAccessGrant).toHaveBeenCalledWith("grant-9", "Left the team", true);
  });
});

describe("Access groups and Workloads", () => {
  it("shows Entra groups as sign-in only, with nothing to remove here", async () => {
    renderAt("/admin/access/groups");
    const groupRow = (await screen.findByText("OnBoard Viewers")).closest("tr")!;
    expect(screen.getByRole("columnheader", { name: "Entra app role" })).toBeInTheDocument();
    expect(within(groupRow).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByText(/it grants nothing inside it/)).toBeInTheDocument();
  });

  it("flags a workload that holds a person's app role", async () => {
    renderAt("/admin/access/workloads");
    const row = (await screen.findByText("legacy-importer")).closest("tr")!;
    expect(within(row).getByText("Holds a person’s app role")).toBeInTheDocument();
  });
});

describe("Add access", () => {
  it("finds somebody in Entra and grants the role against the person OnBoard knows", async () => {
    vi.mocked(api.searchAccessDirectory).mockResolvedValue({ candidates: [{
      id: "user-1",
      display_name: "Taylor Operator",
      sign_in_name: "taylor@example.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [],
      effective_roles: [],
    }] });
    vi.mocked(api.grantAccessRole).mockResolvedValue({ disposition: "applied", grantId: "grant-5" });

    renderAt("/admin/access/add");
    await userEvent.type(await screen.findByRole("searchbox", { name: "Search Entra directory" }), "Taylor");
    await userEvent.click(screen.getByRole("button", { name: "Search Entra" }));
    await userEvent.click(await screen.findByRole("radio", { name: /Taylor Operator/ }));
    // What the role allows is on the card, not behind it.
    expect(screen.getByText("Read-only cover for the dispatch desk.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Viewer/ }));
    await userEvent.type(screen.getByRole("textbox", { name: /Business reason/ }), "Weekend cover");

    await userEvent.click(screen.getByRole("button", { name: "Grant role" }));
    expect(api.grantAccessRole).toHaveBeenCalledWith("person-1", { role_key: "viewer", reason: "Weekend cover", expires_at: null }, false);
    expect(await screen.findByText("Taylor Operator now holds Viewer.")).toBeInTheDocument();
  });

  // Sign-in used to be the only way into OnBoard's people, so a new starter had
  // to be turned away once before they could be given their role. Granting now
  // records them from the directory first.
  it("grants a role to somebody who has never signed in, recording them from the directory", async () => {
    vi.mocked(api.searchAccessDirectory).mockResolvedValue({ candidates: [{
      id: "user-404",
      display_name: "Morgan Manager",
      sign_in_name: "morgan@example.com",
      principal_type: "user",
      account_enabled: true,
      guest_state: null,
      assignments: [],
      effective_roles: [],
    }] });

    vi.mocked(api.grantAccessRole).mockResolvedValue({ disposition: "applied", grantId: "grant-8" });

    renderAt("/admin/access/add");
    await userEvent.type(await screen.findByRole("searchbox", { name: "Search Entra directory" }), "Morgan");
    await userEvent.click(screen.getByRole("button", { name: "Search Entra" }));
    await userEvent.click(await screen.findByRole("radio", { name: /Morgan Manager/ }));

    expect(screen.getByText(/Morgan Manager has not signed in to OnBoard yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Viewer/ }));
    await userEvent.type(screen.getByRole("textbox", { name: /Business reason/ }), "Starts Monday");
    await userEvent.click(screen.getByRole("button", { name: "Grant role" }));

    expect(api.addAccessPerson).toHaveBeenCalledWith({ object_id: "user-404", name: "Morgan Manager", email: "morgan@example.com" });
    expect(api.grantAccessRole).toHaveBeenCalledWith("person-new", { role_key: "viewer", reason: "Starts Monday", expires_at: null }, false);
    expect(await screen.findByText("Morgan Manager now holds Viewer.")).toBeInTheDocument();
  });

  it("does not record a person twice when OnBoard already knows them", async () => {
    vi.mocked(api.searchAccessDirectory).mockResolvedValue({ candidates: [{
      id: "user-1", display_name: "Taylor Operator", sign_in_name: "taylor@example.com", principal_type: "user",
      account_enabled: true, guest_state: null, assignments: [], effective_roles: [],
    }] });
    vi.mocked(api.grantAccessRole).mockResolvedValue({ disposition: "applied", grantId: "grant-9" });

    renderAt("/admin/access/add");
    await userEvent.type(await screen.findByRole("searchbox", { name: "Search Entra directory" }), "Taylor");
    await userEvent.click(screen.getByRole("button", { name: "Search Entra" }));
    await userEvent.click(await screen.findByRole("radio", { name: /Taylor Operator/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Viewer/ }));
    await userEvent.type(screen.getByRole("textbox", { name: /Business reason/ }), "Weekend cover");
    await userEvent.click(screen.getByRole("button", { name: "Grant role" }));

    expect(api.addAccessPerson).not.toHaveBeenCalled();
    expect(api.grantAccessRole).toHaveBeenCalledWith("person-1", { role_key: "viewer", reason: "Weekend cover", expires_at: null }, false);
  });

  it("reads a privileged grant as needing a second Access Administrator, not as an error", async () => {
    vi.mocked(api.searchAccessDirectory).mockResolvedValue({ candidates: [{
      id: "user-1", display_name: "Taylor Operator", sign_in_name: "taylor@example.com", principal_type: "user",
      account_enabled: true, guest_state: null, assignments: [], effective_roles: [],
    }] });
    vi.mocked(api.grantAccessRole).mockResolvedValue({ disposition: "pending_approval", requestId: "request-3" });

    renderAt("/admin/access/add");
    await userEvent.type(await screen.findByRole("searchbox", { name: "Search Entra directory" }), "Taylor");
    await userEvent.click(screen.getByRole("button", { name: "Search Entra" }));
    await userEvent.click(await screen.findByRole("radio", { name: /Taylor Operator/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Access Administrator/ }));
    await userEvent.type(screen.getByRole("textbox", { name: /Business reason/ }), "Second approver");

    await userEvent.click(screen.getByRole("button", { name: "Request this role" }));
    expect(await screen.findByText("Access Administrator for Taylor Operator is waiting for a second Access Administrator to approve it.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Approvals", () => {
  it("does not offer a requester a decision on their own request", async () => {
    vi.mocked(api.getAccessGrantRequests).mockResolvedValue({ requests: [grantRequest()] });
    renderAt("/admin/access/approvals");

    const card = await screen.findByRole("article", { name: "Grant Access Administrator to Taylor Operator" });
    expect(within(card).getByText("Awaiting another Access Administrator")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Cancel request" })).toBeInTheDocument();
  });

  it("lets a second administrator approve, and shows a request past its window as expired", async () => {
    vi.mocked(api.getAccessGrantRequests).mockResolvedValue({ requests: [
      grantRequest({ requestId: "request-2", requestedByObjectId: "actor-9", requestedByName: "sam@example.com" }),
      grantRequest({
        requestId: "request-3",
        action: "revoke",
        personName: "Riley Guest",
        status: "expired",
        requestedByObjectId: "actor-9",
        requestedByName: "sam@example.com",
        approvalExpiresAt: new Date(Date.now() - 3_600_000).toISOString(),
      }),
    ] });
    vi.mocked(api.decideAccessGrantRequest).mockResolvedValue({ status: "approved", grantId: "grant-8" });
    renderAt("/admin/access/approvals");

    const expired = await screen.findByRole("article", { name: "Remove Access Administrator from Riley Guest" });
    expect(within(expired).getByText("Expired")).toBeInTheDocument();
    expect(within(expired).queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();

    const other = screen.getByRole("article", { name: "Grant Access Administrator to Taylor Operator" });
    await userEvent.click(within(other).getByRole("button", { name: "Approve" }));
    // The step-up is asked for by the client; the page only names the decision.
    expect(api.decideAccessGrantRequest).toHaveBeenCalledWith("request-2", "approve");
  });
});

describe("Access health", () => {
  it("reads OnBoard's own grants on first visit and points at what to do", async () => {
    vi.mocked(api.getAccessHealthFindings).mockResolvedValue({ findings: [
      {
        code: "signed_in_without_access",
        severity: "attention",
        headline: "1 person has signed in and holds no role",
        detail: "They can reach OnBoard but see the No access page.",
        people: ["Riley Guest"],
      },
      {
        code: "roles_nobody_holds",
        severity: "watch",
        headline: "1 role is held by nobody",
        detail: "Either somebody should hold it, or it can be archived.",
        people: ["Weekend Dispatcher"],
      },
    ] });

    renderAt("/admin/access/health");
    expect(await screen.findByText("1 person has signed in and holds no role")).toBeInTheDocument();
    expect(api.getAccessHealthFindings).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Riley Guest")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show them in People & guests" })).toHaveAttribute("href", "/admin/access/people?show=nothing");
    // The Entra reconciliation and its repairs are gone.
    expect(screen.queryByRole("button", { name: /repairs/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Worth watching" })).toBeInTheDocument();
  });
});

describe("Activity log", () => {
  it("shows actions in words, names OnBoard people, and narrows to failures", async () => {
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

  // The grants people make live in OnBoard's own tables; the Graph-era audit
  // records only what was looked at. Reading one without the other showed a
  // log of previews with every real change missing.
  it("shows OnBoard's own grants and role edits alongside the older audit", async () => {
    vi.mocked(api.getAccessActivity).mockResolvedValue({ activity: [
      { id: "g1:granted", actor_name: "Alex Administrator", action: "access_grant", target_id: "person-1", target_name: "Taylor Operator", role: "Viewer", reason: null, outcome: "completed", occurred_at: "2026-09-17T14:00:00Z" },
      { id: "h1", actor_name: "Alex Administrator", action: "role_edited", target_id: null, target_name: null, role: "Publisher", reason: "Added event messages.", outcome: "completed", occurred_at: "2026-09-17T13:00:00Z" },
    ] });
    vi.mocked(api.getAccessAudit).mockResolvedValue({ audit: [
      { id: "a1", environment: "test", actor_id: "x", actor_name: "Priya Shah", action: "access_change_previewed", target_id: null, reason: null, outcome: "validated", correlation_id: null, occurred_at: "2026-09-16T15:00:00Z" },
    ] });
    renderAt("/admin/access/activity");

    expect(await screen.findByText("3 entries")).toBeInTheDocument();
    const granted = (await screen.findByRole("cell", { name: "Granted access" })).closest("tr")!;
    expect(within(granted).getByRole("cell", { name: "Viewer" })).toBeInTheDocument();
    expect(within(granted).getByRole("cell", { name: "Taylor Operator" })).toBeInTheDocument();
    const edited = screen.getByRole("cell", { name: "Edited a role" }).closest("tr")!;
    expect(within(edited).getByRole("cell", { name: "Publisher" })).toBeInTheDocument();
    // Newest first, whichever record a row came from.
    expect(screen.getAllByRole("row")[2]).toBe(granted);
  });
});

describe("Recent activity on the Overview", () => {
  it("shows what changed, names an actor the older audit kept only as an id, and leaves looking out", async () => {
    vi.mocked(api.getAccessActivity).mockResolvedValue({ activity: [
      { id: "g1:granted", actor_name: "Alex Administrator", action: "access_grant", target_id: "person-1", target_name: "Taylor Operator", role: "Viewer", reason: null, outcome: "completed", occurred_at: "2026-09-17T14:00:00Z" },
    ] });
    vi.mocked(api.getAccessAudit).mockResolvedValue({ audit: [
      // Recorded before the sign-in carried a name: the id is Taylor's, and
      // the feed used to print the raw GUID.
      { id: "a1", environment: "test", actor_id: "user-1", actor_name: "user-1", action: "guest_invitation", target_id: "user-2", reason: null, outcome: "completed", correlation_id: null, occurred_at: "2026-09-17T12:00:00Z" },
      { id: "a2", environment: "test", actor_id: "user-1", actor_name: "user-1", action: "access_change_previewed", target_id: null, reason: null, outcome: "validated", correlation_id: null, occurred_at: "2026-09-17T13:00:00Z" },
    ] });
    renderAt("/admin/access");

    const feed = (await screen.findByRole("heading", { name: "Recent activity" })).closest("section")!;
    expect(within(feed).getByText(/Granted access · Taylor Operator · Viewer/)).toBeInTheDocument();
    expect(within(feed).getByText(/Invited a guest · Riley Guest/)).toBeInTheDocument();
    expect(within(feed).queryByText(/user-1/)).not.toBeInTheDocument();
    // Previews belong to the Activity log, not to what changed.
    expect(within(feed).queryByText(/Checked a change/)).not.toBeInTheDocument();
  });
});
