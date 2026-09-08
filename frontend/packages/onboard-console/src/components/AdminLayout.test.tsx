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
    expect(screen.getByRole("link", { name: "Service Standards" })).toHaveAttribute("href", "/admin/service-standards");
    expect(screen.getByRole("link", { name: "Integrations & Data Health" })).toHaveAttribute("href", "/admin/integrations");
    expect(screen.getByRole("link", { name: "OTP Compliance" })).toHaveAttribute("href", "/admin/otp-compliance");
    expect(screen.getByRole("link", { name: "Governance & Audit" })).toHaveAttribute("href", "/admin/governance");
  });

  it("keeps Event Administration hidden from an Access Administrator", () => {
    renderLayout(["OCC.AccessAdmin"]);

    expect(screen.getByRole("link", { name: "Access & Identity" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Governance & Audit" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Event Administration" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Service Configuration" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "OTP Compliance" })).not.toBeInTheDocument();
  });
  it("groups the performance-assessment sections under one heading", () => {
    // Four separate jobs on one body of work: who the contractor is, what they
    // are contracted to, what they are held to, and the vocabulary behind it.
    renderLayout(["OCC.Admin"]);
    expect(screen.getByText("Performance Assessment")).toBeInTheDocument();
    for (const label of ["Contractors", "Agreements", "Standards", "Lists"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    // Ungrouped pages keep their flat position rather than joining a group.
    expect(screen.getByRole("link", { name: "Decision Matrix" })).toBeInTheDocument();
  });
});
