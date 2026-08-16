import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AuthContext, type AuthState } from "../auth/AuthContext.js";
import { AdminLayout } from "./AdminLayout.js";

function renderLayout(roles: AuthState["roles"]) {
  return render(
    <AuthContext.Provider value={{ account: { username: "admin@example.com" }, roles, signIn: () => undefined, signOut: () => undefined }}>
      <MemoryRouter initialEntries={["/admin"]}><AdminLayout /></MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe("Administration navigation", () => {
  afterEach(cleanup);

  it("shows the modular administration areas to an Operations Administrator", () => {
    renderLayout(["OCC.Admin"]);

    expect(screen.getByRole("link", { name: "Access & Identity" })).toHaveAttribute("href", "/admin/access");
    expect(screen.getByRole("link", { name: "Event Administration" })).toHaveAttribute("href", "/admin/events");
    expect(screen.getByRole("link", { name: "Service Configuration" })).toHaveAttribute("href", "/admin/service");
    expect(screen.getByRole("link", { name: "Integrations & Data Health" })).toHaveAttribute("href", "/admin/integrations");
    expect(screen.getByRole("link", { name: "Governance & Audit" })).toHaveAttribute("href", "/admin/governance");
  });

  it("keeps Event Administration hidden from an Access Administrator", () => {
    renderLayout(["OCC.AccessAdmin"]);

    expect(screen.getByRole("link", { name: "Access & Identity" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Governance & Audit" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Event Administration" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Service Configuration" })).not.toBeInTheDocument();
  });
});
