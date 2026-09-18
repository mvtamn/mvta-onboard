import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AccessContext, accessStateWith } from "../auth/AccessContext.js";
import { AdminHome } from "./AdminHome.js";
import { AdminLayout } from "./AdminLayout.js";
import { ADMIN_AREAS, quickFindEntries, searchQuickFind } from "./adminNav.js";

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

// What each administrator holds, in Module Actions (ADR-0032).
const OPERATIONS_ADMIN = ["service-configuration.edit", "decision-matrix.manage", "contractor-performance.view", "integrations-health.view"];
const ACCESS_ADMIN = ["access-identity.view", "subscribers.view", "governance-audit.view"];

function renderAt(path: string, actions: string[]) {
  return render(
    <AccessContext.Provider value={accessStateWith(actions)}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminHome />} />
            <Route path="*" element={<Where />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AccessContext.Provider>,
  );
}

function hrefOf(name: string | RegExp, scope: HTMLElement = document.body) {
  return within(scope).getByRole("link", { name }).getAttribute("href");
}

describe("Administration home", () => {
  afterEach(cleanup);

  it("lists every area and page to someone who holds both administrator roles", () => {
    renderAt("/admin", [...OPERATIONS_ADMIN, ...ACCESS_ADMIN]);

    for (const area of ADMIN_AREAS) {
      expect(screen.getByRole("heading", { name: area.name })).toBeInTheDocument();
    }
    expect(hrefOf(/^Access & Identity/)).toBe("/admin/access");
    expect(hrefOf(/^Event Administration/)).toBe("/admin/events");
    expect(hrefOf(/^Contractor Performance/)).toBe("/admin/performance/contractors");
    expect(hrefOf(/^Governance & Audit/)).toBe("/admin/governance");
  });

  it("keeps the access pages from an Operations Administrator, whose routes refuse them", () => {
    renderAt("/admin", OPERATIONS_ADMIN);

    expect(screen.getByRole("heading", { name: "Service Setup" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "People & Access" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Governance" })).not.toBeInTheDocument();
  });

  it("leaves out the pages and areas an Access Administrator cannot open", () => {
    renderAt("/admin", ACCESS_ADMIN);

    expect(screen.getByRole("heading", { name: "People & Access" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Governance" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Service Setup" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Standards & Contracts" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Event Administration/ })).not.toBeInTheDocument();
  });

  it("shows no breadcrumb on the home page itself", () => {
    renderAt("/admin", OPERATIONS_ADMIN);
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
  });
});

describe("Inside an Administration page", () => {
  afterEach(cleanup);

  it("names the area in the breadcrumb and shows Access & Identity's routes as tabs", () => {
    renderAt("/admin/access/people", ACCESS_ADMIN);

    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(hrefOf("Administration", crumbs)).toBe("/admin");
    expect(within(crumbs).getByRole("button", { name: "People & Access" })).toHaveAttribute("aria-expanded", "false");

    const tabs = screen.getByRole("navigation", { name: "Access & Identity" });
    const expected: Record<string, string> = {
      "Overview": "/admin/access",
      "People & guests": "/admin/access/people",
      "Access groups": "/admin/access/groups",
      "Workloads": "/admin/access/workloads",
      "Approvals": "/admin/access/approvals",
      "Access health": "/admin/access/health",
      "Activity log": "/admin/access/activity",
    };
    for (const [label, href] of Object.entries(expected)) expect(hrefOf(label, tabs)).toBe(href);
    expect(within(tabs).getByRole("link", { name: "People & guests" })).toHaveAttribute("aria-current", "page");
    // The overview matches exactly, so it is not also current beneath it.
    expect(within(tabs).getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("gives Contractor Performance its four sections as tabs", () => {
    renderAt("/admin/performance/lists", OPERATIONS_ADMIN);

    expect(screen.getByRole("button", { name: "Standards & Contracts" })).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Contractor Performance" });
    expect(within(tabs).getAllByRole("link").map((link) => link.textContent)).toEqual(["Contractors", "Agreements", "Standards", "Lists"]);
    expect(within(tabs).getByRole("link", { name: "Lists" })).toHaveAttribute("aria-current", "page");
  });

  it("does not mistake Service Standards for Service Configuration", () => {
    renderAt("/admin/service-standards", OPERATIONS_ADMIN);
    expect(within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Service Standards")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Standards & Contracts" })).toBeInTheDocument();
  });

  it("opens the area switcher with every area the role can open", () => {
    renderAt("/admin/decision-matrix", OPERATIONS_ADMIN);

    const toggle = screen.getByRole("button", { name: "Service Setup" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById("admin-switcher-panel")!;
    expect(hrefOf("Integrations & Data Health", panel)).toBe("/admin/integrations");
    expect(within(panel).getByRole("link", { name: "Decision Matrix" })).toHaveAttribute("aria-current", "page");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Quick find", () => {
  afterEach(cleanup);

  it("opens on Ctrl+K, finds a tab by name, and goes there on Enter", () => {
    renderAt("/admin/service", [...OPERATIONS_ADMIN, ...ACCESS_ADMIN]);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox", { name: "Find a page or tab" });
    fireEvent.change(input, { target: { value: "approv" } });
    expect(screen.getByRole("option", { name: /Approvals/ })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("where")).toHaveTextContent("/admin/access/approvals");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens from the home page's find field and closes on Escape", () => {
    renderAt("/admin", OPERATIONS_ADMIN);

    fireEvent.click(screen.getByRole("button", { name: /Find a page or tab/ }));
    const input = screen.getByRole("combobox", { name: "Find a page or tab" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("never offers a page the role cannot open", () => {
    renderAt("/admin/governance", ACCESS_ADMIN);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.change(screen.getByRole("combobox", { name: "Find a page or tab" }), { target: { value: "service" } });
    expect(screen.queryByRole("option", { name: /Service Configuration/ })).not.toBeInTheDocument();
    expect(screen.getByText(/No page or tab is called that/)).toBeInTheDocument();
  });

  it("ranks a name match above a match on its area", () => {
    const entries = quickFindEntries(ADMIN_AREAS);
    const labels = searchQuickFind(entries, "stand").map((entry) => entry.label);
    expect(labels.slice(0, 2).sort()).toEqual(["Service Standards", "Standards"]);
    expect(labels).toContain("OTP Compliance");
    // An empty query lists the pages alone.
    expect(searchQuickFind(entries, "").every((entry) => entry.kind === "page")).toBe(true);
  });
});
