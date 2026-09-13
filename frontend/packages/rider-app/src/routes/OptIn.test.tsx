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

const agree = () => userEvent.click(screen.getByRole("checkbox", { name: /agree/i }));
const submit = () => userEvent.click(screen.getByRole("button", { name: /^subscribe$/i }));

/**
 * Fill in the opt-in form and submit it, landing on the success screen. The
 * channel choice follows from what is given, the way a rider would choose it.
 */
async function subscribeWith({ phone, email }: { phone?: string; email?: string }) {
  render(<OptIn />);
  const choice = phone && email ? "Both" : phone ? "Text" : "Email";
  await userEvent.click(screen.getByRole("radio", { name: choice }));
  if (phone) await userEvent.type(screen.getByLabelText(/mobile number/i), phone);
  if (email) await userEvent.type(screen.getByLabelText(/email address/i), email);
  await agree();
  await submit();
  return screen.findByRole("heading", { name: /^check your/i });
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

describe("choosing how to get alerts", () => {
  it("asks first, defaults to both, and shows only the fields a choice needs", async () => {
    render(<OptIn />);
    expect(screen.getByRole("radio", { name: "Both" })).toBeChecked();
    expect(screen.getByLabelText(/mobile number/i)).toBeTruthy();
    expect(screen.getByLabelText(/email address/i)).toBeTruthy();

    await userEvent.click(screen.getByRole("radio", { name: "Text" }));
    expect(screen.getByLabelText(/mobile number/i)).toBeTruthy();
    expect(screen.queryByLabelText(/email address/i)).toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: "Email" }));
    expect(screen.queryByLabelText(/mobile number/i)).toBeNull();
    expect(screen.getByLabelText(/email address/i)).toBeTruthy();
  });

  it("does not send a field the rider switched away from", async () => {
    // Typed before choosing Text only. Sending it anyway would start an email
    // subscription the rider has since said they don't want.
    render(<OptIn />);
    await userEvent.type(screen.getByLabelText(/email address/i), "rider@example.com");
    await userEvent.click(screen.getByRole("radio", { name: "Text" }));
    await userEvent.type(screen.getByLabelText(/mobile number/i), "612-555-0123");
    await agree();
    await submit();
    expect(api.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ phone_number: "+16125550123", email: undefined }),
    );
  });

  it("treats both as both, and says which field is missing and what to choose instead", async () => {
    render(<OptIn />);
    await userEvent.type(screen.getByLabelText(/mobile number/i), "612-555-0123");
    await agree();
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/email address, or choose text/i);
    expect(screen.getByLabelText(/email address/i)).toHaveAttribute("aria-invalid", "true");
    expect(api.subscribe).not.toHaveBeenCalled();
  });

  it("clears the error once the rider changes something", async () => {
    render(<OptIn />);
    await submit();
    expect(screen.getByRole("alert")).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: "Email" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("will not subscribe to no alerts at all", async () => {
    render(<OptIn />);
    await userEvent.type(screen.getByLabelText(/mobile number/i), "612-555-0123");
    await userEvent.type(screen.getByLabelText(/email address/i), "rider@example.com");
    for (const box of screen.getAllByRole("checkbox").filter((b) => !/agree/i.test(b.closest("label")?.textContent ?? ""))) {
      await userEvent.click(box);
    }
    await agree();
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least one kind of alert/i);
    expect(api.subscribe).not.toHaveBeenCalled();
  });

  it("names the channels that were chosen on the success screen", async () => {
    expect(await subscribeWith({ phone: "612-555-0123", email: "rider@example.com" })).toHaveTextContent(/^check your phone and email$/i);
    cleanup();
    expect(await subscribeWith({ phone: "612-555-0123" })).toHaveTextContent(/^check your phone$/i);
    cleanup();
    expect(await subscribeWith({ email: "rider@example.com" })).toHaveTextContent(/^check your email$/i);
  });
});
