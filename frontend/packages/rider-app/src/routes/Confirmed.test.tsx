import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Confirmed, describeOutcome } from "./Confirmed.js";

// What is worth testing on a page that only renders words: that every status
// the server can send has words at all, that a status it cannot send does not
// produce an empty page, and that the resend form keeps the promise the
// endpoint can actually keep - which is a weaker promise than it looks.

vi.mock("../config.js", () => ({
  api: { resendConfirmation: vi.fn(async () => ({ status: "ok" as const })) },
}));
const { api } = await import("../config.js");

function renderAt(query: string) {
  return render(
    <MemoryRouter initialEntries={[`/subscribe/confirmed${query}`]}>
      <Confirmed />
    </MemoryRouter>,
  );
}

// vitest runs without injected globals here (same as the console), so
// testing-library's automatic cleanup never registers itself.
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe("describeOutcome", () => {
  it("has copy for every status the endpoint can redirect with", () => {
    for (const status of ["confirmed", "already_confirmed", "superseded", "expired", "opted_out", "invalid"] as const) {
      for (const channel of ["email", "sms"] as const) {
        const outcome = describeOutcome(status, channel);
        expect(outcome.title.length, `${status}/${channel}`).toBeGreaterThan(0);
        expect(outcome.body.length, `${status}/${channel}`).toBeGreaterThan(0);
      }
    }
  });

  it("offers a resend exactly where a resend is the way out", () => {
    // Asking for a new code cannot help someone already confirmed, and must
    // not be offered to someone who unsubscribed - re-sending to a person who
    // asked us to stop is the failure that guard exists for.
    expect(describeOutcome("expired", "email").resend).toBe(true);
    expect(describeOutcome("superseded", "email").resend).toBe(true);
    expect(describeOutcome("invalid", "email").resend).toBe(true);
    expect(describeOutcome("confirmed", "email").resend).toBe(false);
    expect(describeOutcome("already_confirmed", "email").resend).toBe(false);
    expect(describeOutcome("opted_out", "email").resend).toBe(false);
  });

  it("names the channel that was confirmed, and points at the other one", () => {
    // A rider who clicked the email link has no other way to learn their phone
    // is not done; the server does not disclose the other channel's state, so
    // the sentence is conditional rather than absent.
    const email = describeOutcome("confirmed", "email");
    expect(email.title).toMatch(/email address/);
    expect(email.body).toMatch(/mobile number/);
    const sms = describeOutcome("confirmed", "sms");
    expect(sms.title).toMatch(/mobile number/);
    expect(sms.body).toMatch(/email address/);
  });
});

describe("the landing page", () => {
  it("says the email address is confirmed", () => {
    renderAt("?status=confirmed&channel=email");
    expect(screen.getByRole("heading")).toHaveTextContent(/email address is confirmed/i);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("treats a status it does not recognise as a link that did not work", () => {
    // Anyone can type anything into the query string, and a blank page is the
    // one outcome a rider cannot act on.
    for (const query of ["", "?status=", "?status=banana"]) {
      const { unmount } = renderAt(query);
      expect(screen.getByRole("heading"), query).toHaveTextContent(/didn’t work/i);
      unmount();
    }
  });

  it("does not offer a resend to someone who unsubscribed, and points them at signing up", () => {
    renderAt("?status=opted_out&channel=email");
    expect(screen.queryByRole("button", { name: /send a new one/i })).toBeNull();
    expect(screen.getByRole("link", { name: /sign up for service alerts/i })).toBeTruthy();
  });

  it("sends a typed email address to the resend endpoint as an email", async () => {
    renderAt("?status=expired&channel=email");
    await userEvent.type(screen.getByRole("textbox"), "rider@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send a new one/i }));
    expect(api.resendConfirmation).toHaveBeenCalledWith({ email: "rider@example.com" });
  });

  it("normalizes a typed mobile number before sending it", async () => {
    // The API stores E.164; "(612) 555-0123" arriving unchanged matches no row.
    renderAt("?status=expired&channel=email");
    await userEvent.type(screen.getByRole("textbox"), "(612) 555-0123");
    await userEvent.click(screen.getByRole("button", { name: /send a new one/i }));
    expect(api.resendConfirmation).toHaveBeenCalledWith({ phone_number: "+16125550123" });
  });

  it("promises only what the endpoint can keep", async () => {
    // The endpoint answers the same whether or not that contact exists, so the
    // acknowledgement must not claim anything was actually sent.
    renderAt("?status=expired&channel=email");
    await userEvent.type(screen.getByRole("textbox"), "nobody@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send a new one/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/if that contact is waiting/i);
  });

  it("reports an unreachable API as MVTA's problem, not the rider's", async () => {
    vi.mocked(api.resendConfirmation).mockRejectedValueOnce(new Error("offline"));
    renderAt("?status=expired&channel=email");
    await userEvent.type(screen.getByRole("textbox"), "rider@example.com");
    await userEvent.click(screen.getByRole("button", { name: /send a new one/i }));
    expect(await screen.findByText(/couldn’t reach MVTA/i)).toBeTruthy();
  });
});
