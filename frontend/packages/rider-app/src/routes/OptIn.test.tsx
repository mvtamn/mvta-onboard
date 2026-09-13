import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OptIn } from "./OptIn.js";

// The success screen, which is now where the SMS channel is actually finished:
// replying to the text needs a toll-free number that is still in carrier
// verification, so typing the code here is the only path that works today.

vi.mock("../config.js", () => ({
  api: {
    subscribe: vi.fn(async () => ({ subscriber_id: "sub-1", status: "pending_confirmation" })),
    confirmSms: vi.fn(async () => ({ status: "confirmed" as const, channel: "sms" as const })),
    resendConfirmation: vi.fn(async () => ({ status: "ok" as const })),
  },
}));
const { api } = await import("../config.js");

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

/** Fill in the opt-in form and submit it, landing on the success screen. */
async function subscribeWith({ phone, email }: { phone?: string; email?: string }) {
  render(<OptIn />);
  if (phone) await userEvent.type(screen.getByLabelText(/mobile number/i), phone);
  if (email) await userEvent.type(screen.getByLabelText(/email/i), email);
  await userEvent.click(screen.getByRole("checkbox", { name: /agree/i }));
  await userEvent.click(screen.getByRole("button", { name: /subscribe|get alerts|notify/i }));
  return screen.findByRole("heading", { name: /check your phone or email/i });
}

describe("the opt-in success screen", () => {
  it("offers the code box only when a mobile number was given", async () => {
    await subscribeWith({ email: "rider@example.com" });
    expect(screen.queryByLabelText(/6-digit code/i)).toBeNull();
    cleanup();

    await subscribeWith({ phone: "612-555-0123" });
    expect(screen.getByLabelText(/6-digit code/i)).toBeTruthy();
  });

  it("confirms the number the API stored, not the one that was typed", async () => {
    await subscribeWith({ phone: "(612) 555-0123" });
    await userEvent.type(screen.getByLabelText(/6-digit code/i), "123456");
    await userEvent.click(screen.getByRole("button", { name: /confirm my number/i }));
    expect(api.confirmSms).toHaveBeenCalledWith({ phone_number: "+16125550123", code: "123456" });
    expect(await screen.findByRole("status")).toHaveTextContent(/mobile number is confirmed/i);
  });

  it("keeps non-digits out of the code, and will not submit a partial one", async () => {
    await subscribeWith({ phone: "612-555-0123" });
    const box = screen.getByLabelText(/6-digit code/i);
    await userEvent.type(box, "12a3b4");
    expect(box).toHaveValue("1234");
    expect(screen.getByRole("button", { name: /confirm my number/i })).toBeDisabled();
  });

  it("gives one message for every way a code can fail, with the remedy beside it", async () => {
    // The endpoint collapses wrong / expired / locked out into `invalid` on
    // purpose, so there is exactly one sentence to write - and it has to carry
    // the only action that fixes all three.
    vi.mocked(api.confirmSms).mockResolvedValueOnce({ status: "invalid" });
    await subscribeWith({ phone: "612-555-0123" });
    await userEvent.type(screen.getByLabelText(/6-digit code/i), "000000");
    await userEvent.click(screen.getByRole("button", { name: /confirm my number/i }));
    expect(await screen.findByText(/didn’t work/i)).toHaveTextContent(/ask for a new one/i);
    expect(screen.getByRole("button", { name: /send me a new code/i })).toBeTruthy();
  });

  it("says plainly that a new code is coming, because this page knows one is waiting", async () => {
    // Unlike the landing page reached from an email link, this screen created
    // the confirmation itself a moment ago, so it can promise delivery.
    await subscribeWith({ phone: "612-555-0123" });
    await userEvent.click(screen.getByRole("button", { name: /send me a new code/i }));
    expect(api.resendConfirmation).toHaveBeenCalledWith({ phone_number: "+16125550123" });
    expect(await screen.findByRole("status")).toHaveTextContent(/new code is on its way/i);
  });
});
