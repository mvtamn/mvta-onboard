import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { OperatorIdentity } from "./OperatorIdentity.js";

describe("OperatorIdentity", () => {
  it("summarizes roles in the trigger and keeps the complete list in the account menu", async () => {
    render(
      <MemoryRouter>
        <OperatorIdentity
          name="Tyre Fant"
          username="tyre.fant@mvta.com"
          roles={["OCC.Viewer", "OCC.Admin", "OCC.Publisher"]}
          canManageAccess
          onSignOut={vi.fn()}
        />
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
