import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { MyAccess, MyAccessRole } from "@mvta/shared";
import { describe, expect, it, vi } from "vitest";
import { StaticAccessProvider } from "../auth/AccessContext.js";
import { OperatorIdentity } from "./OperatorIdentity.js";

function role(key: string, name: string): MyAccessRole {
  return { key, name, purpose: "", locked: false, source: "onboard", scope: null, expiresAt: null };
}

const access: MyAccess = {
  person: { objectId: "1", tenantId: "t", name: "Tyre Fant", email: "tyre.fant@mvta.com" },
  roles: [role("operations-administrator", "Operations Administrator"), role("viewer", "Viewer"), role("alert-publisher", "Alert Publisher")],
  actions: [],
  summary: [],
  ingestion: false,
  rolesInOnBoard: true,
};

describe("OperatorIdentity", () => {
  it("summarizes roles in the trigger and keeps the complete list in the account menu", async () => {
    render(
      <MemoryRouter>
        <StaticAccessProvider access={access}>
          <OperatorIdentity
            name="Tyre Fant"
            username="tyre.fant@mvta.com"
            canManageAccess
            onSignOut={vi.fn()}
          />
        </StaticAccessProvider>
      </MemoryRouter>,
    );

    const trigger = screen.getByRole("button", { name: /tyre fant/i });
    expect(trigger).toHaveTextContent("Tyre Fant · Operations Administrator +2");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Account details" })).toHaveTextContent("Viewer");
    expect(screen.getByRole("link", { name: "View access" })).toHaveAttribute("href", "/admin/access");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});
