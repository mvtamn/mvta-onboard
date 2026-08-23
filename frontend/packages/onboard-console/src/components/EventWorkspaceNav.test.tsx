import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EventWorkspaceProvider } from "../context/EventWorkspaceContext.js";
import { EventWorkspaceNav } from "./EventWorkspaceNav.js";

afterEach(cleanup);

describe("EventWorkspaceNav", () => {
  it("keeps the Event workspace context on the explicit Admin return action", () => {
    render(
      <MemoryRouter initialEntries={["/admin/events?event=evt1&plan=plan1&revision=rev1"]}>
        <EventWorkspaceProvider>
          <EventWorkspaceNav activeStage="configure" showReturnToPlanning />
        </EventWorkspaceProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Return to Event Planning" })).toHaveAttribute(
      "href",
      "/events/planning?event=evt1&plan=plan1&revision=rev1",
    );
  });

  it("renders the return action without a selected Event", () => {
    render(
      <MemoryRouter initialEntries={["/admin/events"]}>
        <EventWorkspaceProvider>
          <EventWorkspaceNav activeStage="configure" showReturnToPlanning />
        </EventWorkspaceProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Return to Event Planning" })).toHaveAttribute("href", "/events/planning");
  });

  it("places workflow stages in their reserved grid column before the return action", () => {
    render(
      <MemoryRouter initialEntries={["/admin/events?event=evt1"]}>
        <EventWorkspaceProvider>
          <EventWorkspaceNav activeStage="configure" showReturnToPlanning />
        </EventWorkspaceProvider>
      </MemoryRouter>,
    );

    expect(Array.from(screen.getByRole("navigation", { name: "Event workspace" }).children).map((element) => element.className)).toEqual([
      "event-workspace-context",
      "event-workspace-stages",
      "event-workspace-return",
    ]);
  });
});
