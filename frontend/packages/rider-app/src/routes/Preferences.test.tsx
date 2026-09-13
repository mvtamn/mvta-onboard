import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ApiError, type RiderPreferences } from "@mvta/shared";
import { MANAGE_KEY_STORAGE, Preferences } from "./Preferences.js";

// The page a rider reaches from the link in an alert email. What is worth
// pinning here is less "does it render" than the handful of places where a
// careless page would do the wrong thing quietly: leave the key in the address
// bar, read an emptied list as "everything", offer a channel it cannot really
// turn back on, or keep a key the server has already retired.

vi.mock("../config.js", () => ({
  api: {
    getPreferences: vi.fn(),
    updatePreferences: vi.fn(async () => ({ status: "updated" as const })),
    unsubscribeWithManageKey: vi.fn(async () => ({ status: "unsubscribed" as const, changed: true })),
  },
}));
const { api } = await import("../config.js");

const KEY = "a".repeat(64);

function prefs(overrides: Partial<RiderPreferences> = {}): RiderPreferences {
  return {
    phone: "(•••) •••-3275",
    email: null,
    has_sms: true,
    has_email: false,
    status: "confirmed",
    categories: ["delay", "detour"],
    routes: "ALL",
    zones: "ALL",
    sms_status: "confirmed",
    email_status: null,
    options: {
      routes: [
        { id: "470", label: "470 - Burnsville - Minneapolis" },
        { id: "472", label: "472 - Savage - Minneapolis" },
        { id: "495", label: "495 - Burnsville - Mall of America" },
      ],
      zones: [],
    },
    ...overrides,
  };
}

/**
 * Shows where the router thinks it is, so the key's removal can be seen.
 *
 * A div, not an <output>: <output> carries an implicit ARIA role of "status",
 * which made it the first match for the saved-message query below and turned a
 * working page into a failing test.
 */
function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

function renderAt(query = "") {
  return render(
    <MemoryRouter initialEntries={[`/subscribe/preferences${query}`]}>
      <Routes>
        <Route
          path="/subscribe/preferences"
          element={
            <>
              <Preferences />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.mocked(api.getPreferences).mockResolvedValue(prefs());
});

const save = () => userEvent.click(screen.getByRole("button", { name: /save changes/i }));

describe("the manage key", () => {
  it("is taken out of the address bar as soon as the page has it", async () => {
    renderAt(`?key=${KEY}`);
    expect(await screen.findByRole("heading", { name: /your mvta service alerts/i })).toBeTruthy();
    expect(api.getPreferences).toHaveBeenCalledWith(KEY);
    // Left in the URL it can be screenshotted, pasted into a support ticket,
    // or carried off in a referrer - for a credential that does not expire.
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/subscribe\/preferences$/);
  });

  it("survives a reload, since the address bar no longer has it", async () => {
    // There is no way back in otherwise: the email-me-my-link recovery is a
    // later increment.
    sessionStorage.setItem(MANAGE_KEY_STORAGE, KEY);
    renderAt();
    await screen.findByRole("heading", { name: /your mvta service alerts/i });
    expect(api.getPreferences).toHaveBeenCalledWith(KEY);
  });

  it("without one, points the rider at their alert email and asks the API nothing", async () => {
    renderAt();
    expect(await screen.findByRole("heading", { name: /open your link/i })).toBeTruthy();
    expect(api.getPreferences).not.toHaveBeenCalled();
  });

  it("treats a cut-short key as no key, and does not fall back to an older stored one", async () => {
    // The link the rider just opened is what they meant. A key stored from an
    // earlier visit could belong to a different subscription.
    sessionStorage.setItem(MANAGE_KEY_STORAGE, "b".repeat(64));
    renderAt("?key=abc123");
    expect(await screen.findByRole("heading", { name: /open your link/i })).toBeTruthy();
    expect(api.getPreferences).not.toHaveBeenCalled();
  });

  it("is forgotten when the server says it names nothing", async () => {
    vi.mocked(api.getPreferences).mockRejectedValueOnce(new ApiError(404, "not found"));
    renderAt(`?key=${KEY}`);
    expect(await screen.findByRole("heading", { name: /no longer works/i })).toBeTruthy();
    expect(sessionStorage.getItem(MANAGE_KEY_STORAGE)).toBeNull();
  });
});

describe("what the rider sees", () => {
  it("shows the contact masked, exactly as the API sent it", async () => {
    renderAt(`?key=${KEY}`);
    expect(await screen.findByRole("checkbox", { name: "Texts to (•••) •••-3275" })).toBeChecked();
  });

  it("does not offer zones when no zone version is active", async () => {
    renderAt(`?key=${KEY}`);
    await screen.findByRole("heading", { name: /your mvta service alerts/i });
    expect(screen.queryByRole("group", { name: /zones/i })).toBeNull();
  });

  it("offers zones once a version is active", async () => {
    vi.mocked(api.getPreferences).mockResolvedValue(
      prefs({ options: { routes: prefs().options.routes, zones: [{ id: "zone-a", label: "Apple Valley" }] } }),
    );
    renderAt(`?key=${KEY}`);
    expect(await screen.findByRole("group", { name: /which mvta connect zones/i })).toBeTruthy();
  });

  it("an opted-out subscription gets no form, since a save could not revive it", async () => {
    vi.mocked(api.getPreferences).mockResolvedValue(prefs({ status: "opted_out" }));
    renderAt(`?key=${KEY}`);
    expect(await screen.findByRole("heading", { name: /unsubscribed/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
  });

  it("an unreachable API is MVTA's problem, and can be retried", async () => {
    vi.mocked(api.getPreferences).mockRejectedValueOnce(new Error("offline"));
    renderAt(`?key=${KEY}`);
    expect(await screen.findByRole("heading", { name: /couldn’t reach mvta/i })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { name: /your mvta service alerts/i })).toBeTruthy();
  });
});

describe("saving", () => {
  it("narrowing to chosen routes sends exactly those routes", async () => {
    renderAt(`?key=${KEY}`);
    await userEvent.click(await screen.findByRole("radio", { name: /only the routes i choose/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /^472 /i }));
    await save();
    // The whole point of the page: narrowing. A merge would have left "ALL".
    expect(api.updatePreferences).toHaveBeenCalledWith(KEY, {
      categories: ["delay", "detour"],
      routes: ["472"],
      zones: "ALL",
      channels: ["sms"],
    });
  });

  it("'only' with nothing ticked is refused, never saved as every route", async () => {
    renderAt(`?key=${KEY}`);
    await userEvent.click(await screen.findByRole("radio", { name: /only the routes i choose/i }));
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent(/choose at least one route/i);
    expect(api.updatePreferences).not.toHaveBeenCalled();
  });

  it("no categories is refused, and points at unsubscribing", async () => {
    renderAt(`?key=${KEY}`);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Delay" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Detour" }));
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent(/unsubscribe/i);
    expect(api.updatePreferences).not.toHaveBeenCalled();
  });

  it("turning off every channel is refused, and points at unsubscribing", async () => {
    // A save with no channels would opt the rider out but leave this link
    // working; unsubscribing also retires the link and records why.
    renderAt(`?key=${KEY}`);
    await userEvent.click(await screen.findByRole("checkbox", { name: /texts to/i }));
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent(/unsubscribe below/i);
    expect(api.updatePreferences).not.toHaveBeenCalled();
  });

  it("a stopped channel is shown but cannot be switched back on from here", async () => {
    // Re-enabling it would leave it waiting for a confirmation nothing sends -
    // this page only ever sees the contact masked, so it cannot send one.
    vi.mocked(api.getPreferences).mockResolvedValue(
      prefs({ has_email: true, email: "t•••••••t@gmail.com", email_status: "unsubscribed" }),
    );
    renderAt(`?key=${KEY}`);
    const email = await screen.findByRole("checkbox", { name: /emails to/i });
    expect(email).toBeDisabled();
    expect(email).not.toBeChecked();
    expect(screen.getByText(/emails are stopped.*sign up again/i)).toBeTruthy();
    await save();
    expect(api.updatePreferences).toHaveBeenCalledWith(KEY, expect.objectContaining({ channels: ["sms"] }));
  });

  it("a route that no longer runs is taken off the list, and the rider is told", async () => {
    vi.mocked(api.getPreferences).mockResolvedValue(prefs({ routes: ["470", "999"] }));
    renderAt(`?key=${KEY}`);
    expect(await screen.findByText(/no longer run/i)).toBeTruthy();
    const list = screen.getByRole("group", { name: "Routes" });
    expect(within(list).getByRole("checkbox", { name: /^470 /i })).toBeChecked();
    await save();
    // Sending 999 back would be refused by the server as an unknown route.
    expect(api.updatePreferences).toHaveBeenCalledWith(KEY, expect.objectContaining({ routes: ["470"] }));
  });

  it("with no zone choice offered, sends back exactly what was stored", async () => {
    vi.mocked(api.getPreferences).mockResolvedValue(prefs({ zones: ["zone-a"] }));
    renderAt(`?key=${KEY}`);
    await screen.findByRole("heading", { name: /your mvta service alerts/i });
    await save();
    // Not "ALL": a rider who could not see a zone choice has not made one.
    expect(api.updatePreferences).toHaveBeenCalledWith(KEY, expect.objectContaining({ zones: ["zone-a"] }));
  });

  it("re-reads the subscription afterwards, so the page shows what the server stored", async () => {
    renderAt(`?key=${KEY}`);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Detour" }));
    await save();
    expect(await screen.findByRole("status")).toHaveTextContent(/saved/i);
    expect(api.getPreferences).toHaveBeenCalledTimes(2);
  });

  it("confirms the save beside the Save button, where the rider is looking", async () => {
    // Found in the browser: the form is long enough that a rider pressing Save
    // is scrolled past the heading, and a confirmation up there was invisible.
    renderAt(`?key=${KEY}`);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Detour" }));
    await save();
    const saved = await screen.findByRole("status");
    expect(saved.parentElement).toBe(screen.getByRole("button", { name: /save changes/i }).parentElement);
  });

  it("clears the confirmation as soon as the rider changes something else", async () => {
    renderAt(`?key=${KEY}`);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Detour" }));
    await save();
    await screen.findByRole("status");
    await userEvent.click(screen.getByRole("checkbox", { name: "Outage" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a save refused because they opted out elsewhere shows them unsubscribed", async () => {
    vi.mocked(api.updatePreferences).mockRejectedValueOnce(new ApiError(409, "opted out"));
    renderAt(`?key=${KEY}`);
    await screen.findByRole("heading", { name: /your mvta service alerts/i });
    await save();
    expect(await screen.findByRole("heading", { name: /unsubscribed/i })).toBeTruthy();
  });
});

describe("unsubscribing", () => {
  it("asks once, then retires the key the server just rotated", async () => {
    renderAt(`?key=${KEY}`);
    await userEvent.click(await screen.findByRole("button", { name: /unsubscribe from all/i }));
    expect(api.unsubscribeWithManageKey).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /yes, unsubscribe/i }));
    expect(api.unsubscribeWithManageKey).toHaveBeenCalledWith(KEY);
    expect(await screen.findByRole("heading", { name: /unsubscribed/i })).toBeTruthy();
    // Keeping it would mean a reload tries a key that names nothing.
    expect(sessionStorage.getItem(MANAGE_KEY_STORAGE)).toBeNull();
  });

  it("can be backed out of", async () => {
    renderAt(`?key=${KEY}`);
    await userEvent.click(await screen.findByRole("button", { name: /unsubscribe from all/i }));
    await userEvent.click(screen.getByRole("button", { name: /keep my alerts/i }));
    expect(api.unsubscribeWithManageKey).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /unsubscribe from all/i })).toBeTruthy();
  });

  it("a failure says they are still subscribed", async () => {
    vi.mocked(api.unsubscribeWithManageKey).mockRejectedValueOnce(new Error("offline"));
    renderAt(`?key=${KEY}`);
    await userEvent.click(await screen.findByRole("button", { name: /unsubscribe from all/i }));
    await userEvent.click(screen.getByRole("button", { name: /yes, unsubscribe/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/still subscribed/i);
  });
});
