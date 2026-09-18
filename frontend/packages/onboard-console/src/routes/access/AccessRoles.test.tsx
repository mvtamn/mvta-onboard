import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError, type AccessRoleView } from "@mvta/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDialogProvider } from "../../components/AppDialog.js";
import { AccessLayout } from "./AccessUi.js";
import { AccessRoles, actionsChanged, roleSummaryLines } from "./AccessRoles.js";

vi.mock("../../config.js", () => ({
  api: {
    // The section's shared load, which AccessLayout starts.
    getAccessPrincipals: vi.fn(),
    getPendingAccessChanges: vi.fn(),
    getAccessExpirations: vi.fn(),
    getAccessAudit: vi.fn(),
    // The Roles page's own calls.
    getAccessCatalog: vi.fn(),
    getAccessRoles: vi.fn(),
    createAccessRole: vi.fn(),
    updateAccessRole: vi.fn(),
    setAccessRoleArchived: vi.fn(),
    getAccessRoleHistory: vi.fn(),
  },
}));

vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: () => ({ account: { name: "Alex Administrator", username: "alex@example.com" }, signIn: vi.fn(), signOut: vi.fn() }),
}));

vi.mock("../../auth/AccessContext.js", async () => {
  const actual = await vi.importActual<typeof import("../../auth/AccessContext.js")>("../../auth/AccessContext.js");
  return { ...actual, useAccess: () => actual.accessStateWith(["access-identity.view", "access-identity.manage"]) };
});

const { api } = await import("../../config.js");

const MODULES = [
  { key: "dashboard", label: "Dashboard", section: "Service Operations", actions: [{ key: "view", label: "View" }] },
  {
    key: "rider-alerts",
    label: "Rider Alerts",
    section: "Service Operations",
    actions: [{ key: "view", label: "View" }, { key: "publish", label: "Compose, edit, retract and approve alerts" }],
  },
  {
    key: "access-identity",
    label: "Access & Identity",
    section: "Administration",
    actions: [
      { key: "view", label: "View" },
      { key: "manage", label: "Grant access and edit roles" },
      { key: "approve", label: "Approve privileged access changes" },
    ],
  },
];

function role(overrides: Partial<AccessRoleView> & { key: string; name: string }): AccessRoleView {
  const actions = overrides.actions ?? [];
  return {
    purpose: "",
    locked: false,
    allActions: false,
    summary: roleSummaryLines(MODULES, actions),
    members: 0,
    seeded: false,
    archived: false,
    ...overrides,
    actions,
  };
}

const DISPATCHER = role({
  key: "weekend-dispatcher",
  name: "Weekend Dispatcher",
  purpose: "Weekend shift cover for the dispatch desk.",
  actions: ["dashboard.view"],
});

const SYSTEM_ADMIN = role({
  key: "system-administrator",
  name: "System Administrator",
  purpose: "Runs OnBoard.",
  locked: true,
  allActions: true,
  seeded: true,
  members: 3,
});

const ACCESS_ADMIN = role({
  key: "access-administrator",
  name: "Access Administrator",
  purpose: "Grants access and approves privileged changes.",
  locked: true,
  seeded: true,
  members: 2,
  actions: ["access-identity.view", "access-identity.manage", "access-identity.approve"],
});

const HELD = role({ key: "compliance-reader", name: "Compliance Reader", actions: ["dashboard.view"], members: 4 });

function renderRoles() {
  return render(<AppDialogProvider><MemoryRouter initialEntries={["/admin/access/roles"]}>
    <Routes>
      <Route path="/admin/access" element={<AccessLayout />}>
        <Route path="roles" element={<AccessRoles />} />
      </Route>
    </Routes>
  </MemoryRouter></AppDialogProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getAccessPrincipals).mockResolvedValue({ environment: "test", access_admin_fallback: false, principals: [] });
  vi.mocked(api.getPendingAccessChanges).mockResolvedValue({ changes: [] });
  vi.mocked(api.getAccessExpirations).mockResolvedValue({ expirations: [] });
  vi.mocked(api.getAccessAudit).mockResolvedValue({ audit: [] });
  vi.mocked(api.getAccessCatalog).mockResolvedValue({ modules: MODULES });
  vi.mocked(api.getAccessRoles).mockResolvedValue({ roles: [ACCESS_ADMIN, HELD, SYSTEM_ADMIN, DISPATCHER] });
  vi.mocked(api.getAccessRoleHistory).mockResolvedValue({ history: [] });
});

afterEach(cleanup);

async function openRole(name: string) {
  await userEvent.click(await screen.findByRole("button", { name }));
}

const summaryList = () => screen.getByRole("list", { name: "Access summary" });

/** The grid row for one module, so a checkbox is found under its own module. */
const moduleRow = (label: string) => screen.getByText(label).closest<HTMLElement>(".am-mod")!;

describe("Roles", () => {
  it("writes the access summary from the grid as the boxes are ticked", async () => {
    renderRoles();
    await openRole("Weekend Dispatcher");

    expect(within(summaryList()).getByText("Dashboard: view only")).toBeInTheDocument();

    const riderAlerts = moduleRow("Rider Alerts");
    await userEvent.click(within(riderAlerts).getByRole("checkbox", { name: "View" }));
    expect(within(summaryList()).getByText("Rider Alerts: view only")).toBeInTheDocument();

    await userEvent.click(within(riderAlerts).getByRole("checkbox", { name: "Compose, edit, retract and approve alerts" }));
    expect(within(summaryList()).getByText("Rider Alerts: view; Compose, edit, retract and approve alerts")).toBeInTheDocument();

    // Unticking view leaves the action behind, and the summary says so rather
    // than hiding a role that grants an action on a page it cannot open.
    await userEvent.click(within(riderAlerts).getByRole("checkbox", { name: "View" }));
    expect(within(summaryList()).getByText("Rider Alerts: Compose, edit, retract and approve alerts (cannot open the page)")).toBeInTheDocument();
  });

  it("does not offer Access & Identity actions on an ordinary role, and says why", async () => {
    renderRoles();
    await openRole("Weekend Dispatcher");

    const accessModule = moduleRow("Access & Identity");
    expect(within(accessModule).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(accessModule).getByText(/Privileged Access Change/)).toBeInTheDocument();
  });

  it("keeps Save disabled until something changes, then saves the whole role", async () => {
    vi.mocked(api.updateAccessRole).mockResolvedValue({ role: { ...DISPATCHER, actions: ["dashboard.view", "rider-alerts.view"] } });
    renderRoles();
    await openRole("Weekend Dispatcher");

    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByRole("textbox", { name: /Role name/ }), " (pilot)");
    expect(save).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    const riderAlerts = moduleRow("Rider Alerts");
    await userEvent.click(within(riderAlerts).getByRole("checkbox", { name: "View" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(api.updateAccessRole).toHaveBeenCalledWith("weekend-dispatcher", {
      name: "Weekend Dispatcher",
      purpose: "Weekend shift cover for the dispatch desk.",
      actions: ["dashboard.view", "rider-alerts.view"],
    });
  });

  it("shows a locked role read-only and explains the wildcard instead of drawing it", async () => {
    renderRoles();
    await openRole("System Administrator");

    expect(screen.getByText(/is a locked role\./)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Role name/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Archive role" })).not.toBeInTheDocument();
    expect(screen.getByText(/every action outside Access & Identity/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    cleanup();
    renderRoles();
    await openRole("Access Administrator");
    const accessModule = moduleRow("Access & Identity");
    const manage = within(accessModule).getByRole("checkbox", { name: "Grant access and edit roles" });
    expect(manage).toBeChecked();
    expect(manage).toBeDisabled();
  });

  it("blocks archiving a role people still hold, and says how many hold it", async () => {
    renderRoles();
    await openRole("Compliance Reader");

    expect(screen.getByRole("button", { name: "Archive role" })).toBeDisabled();
    expect(screen.getByText("Held by 4 people — remove it from them before archiving.")).toBeInTheDocument();

    cleanup();
    renderRoles();
    await openRole("Weekend Dispatcher");
    expect(screen.getByRole("button", { name: "Archive role" })).toBeEnabled();
    expect(screen.getByText("Nobody holds this role.")).toBeInTheDocument();
  });

  it("says plainly when the environment has no roles tables yet", async () => {
    const message = "Roles are not set up in this environment yet. Apply migrations 129 and 130.";
    vi.mocked(api.getAccessRoles).mockRejectedValue(new ApiError(503, message));
    renderRoles();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText("Roles are not set up in this environment yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New role" })).not.toBeInTheDocument();
  });
});

describe("role summary and history vocabulary", () => {
  it("summarizes a module granted an action it cannot open", () => {
    expect(roleSummaryLines(MODULES, ["rider-alerts.publish"])).toEqual([
      "Rider Alerts: Compose, edit, retract and approve alerts (cannot open the page)",
    ]);
    expect(roleSummaryLines(MODULES, [])).toEqual([]);
  });

  it("reads a history entry as what was added and removed", () => {
    expect(actionsChanged({
      change: "updated",
      actorName: "Alex Administrator",
      occurredAt: "2026-09-17T12:00:00Z",
      before: { name: "Weekend Dispatcher", purpose: "", actions: ["dashboard.view", "rider-alerts.publish"] },
      after: { name: "Weekend Dispatcher", purpose: "", actions: ["dashboard.view", "rider-alerts.view"] },
    })).toEqual({ added: ["rider-alerts.view"], removed: ["rider-alerts.publish"] });
  });
});
