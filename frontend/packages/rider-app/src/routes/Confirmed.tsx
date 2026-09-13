import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { normalizeUsPhone, type ConfirmationStatus } from "@mvta/shared";
import { api } from "../config.js";

// Where a rider lands after clicking the confirmation link in their email.
// `GET /api/subscribers/confirm-email` writes the confirmation and then
// redirects here with ?status= and ?channel=, so by the time this page renders
// the work is already done - this page only says what happened.
//
// Reading the status from the query string means the page cannot verify it, and
// anyone can type any status into the URL. That is acceptable because nothing
// here grants anything: every branch is words plus, at most, an offer to send
// another confirmation, and that offer is answered identically by the server
// whether or not the contact exists. A rider who forges ?status=confirmed has
// lied to their own browser.

const STATUSES: ConfirmationStatus[] = [
  "confirmed",
  "already_confirmed",
  "superseded",
  "expired",
  "opted_out",
  "invalid",
];

function readStatus(value: string | null): ConfirmationStatus {
  return STATUSES.includes(value as ConfirmationStatus) ? (value as ConfirmationStatus) : "invalid";
}

type Channel = "sms" | "email";

function readChannel(value: string | null): Channel {
  return value === "sms" ? "sms" : "email";
}

/** How the rider refers to the thing we sent, by channel. */
const WORDS = {
  email: { contact: "email address", thing: "link", sent: "emailed you", alerts: "emails" },
  sms: { contact: "mobile number", thing: "code", sent: "texted you", alerts: "texts" },
} as const;

interface Outcome {
  title: string;
  body: string;
  /** Whether asking for a fresh link or code is the way out of this. */
  resend: boolean;
}

export function describeOutcome(status: ConfirmationStatus, channel: Channel): Outcome {
  const w = WORDS[channel];
  const other = channel === "email" ? WORDS.sms : WORDS.email;
  switch (status) {
    case "confirmed":
      return {
        title: `Your ${w.contact} is confirmed`,
        // The second sentence is shown to everyone rather than only to riders
        // who gave both contacts, because this page cannot know which they
        // are: the server deliberately does not disclose the other channel's
        // state, and asking it to would be a worse trade than one conditional
        // sentence. Phrased as a condition so it reads correctly either way.
        body:
          `You’ll start getting ${w.alerts} about delays, detours, and closures. ` +
          `If you also signed up with a ${other.contact}, that still needs confirming ` +
          `— look for the ${other.thing} we ${other.sent}.`,
        resend: false,
      };
    case "already_confirmed":
      return {
        title: "You’re already confirmed",
        body: `That ${w.thing} has already been used. There’s nothing more to do.`,
        resend: false,
      };
    case "superseded":
      return {
        title: `That ${w.thing} has been replaced`,
        body:
          `A newer ${w.thing} was sent after this one, and only the newest works. ` +
          `Use the most recent one we ${w.sent}.`,
        resend: true,
      };
    case "expired":
      return {
        title: `That ${w.thing} has expired`,
        body: `Confirmation ${w.thing}s last 24 hours. Ask for a new one and we’ll send it now.`,
        resend: true,
      };
    case "opted_out":
      return {
        title: "You’ve unsubscribed from MVTA alerts",
        body:
          `This ${w.thing} can’t turn them back on — and we won’t, without you asking. ` +
          `If you’d like alerts again, sign up below.`,
        resend: false,
      };
    case "invalid":
      return {
        title: `That ${w.thing} didn’t work`,
        body:
          `It may have been cut short by your mail program, or already used. ` +
          `Ask for a new one and we’ll send it now.`,
        resend: true,
      };
  }
}

// Asking for another link or code.
//
// The contact has to be typed in, because the page does not have it: the
// redirect that brought the rider here deliberately carries no address or
// number. The acknowledgement is the same whatever the server found, which is
// the same reason the endpoint answers the same to everyone - so the sentence
// below is careful to promise nothing about whether that contact exists.
function ResendForm() {
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const typed = contact.trim();
    if (!typed) return;
    setState("sending");
    // An "@" is the only signal available, and the server is the thing that
    // decides - a number it cannot read is simply a contact with nothing
    // waiting on it, which answers the same as every other case.
    const phone = typed.includes("@") ? null : normalizeUsPhone(typed);
    try {
      await api.resendConfirmation(
        phone ? { phone_number: phone } : { email: typed },
      );
      setState("sent");
    } catch {
      // Not reported as a failure of the rider's: the endpoint answers 200 to
      // everything it can, so reaching here means the request did not arrive.
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <p className="subtitle" role="status">
        If that contact is waiting to be confirmed, a new one is on its way. It can take a
        minute to arrive.
      </p>
    );
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field">
        <span>Your mobile number or email address</span>
        <input
          type="text"
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          placeholder="(612) 555-0123 or you@example.com"
          autoComplete="email"
        />
      </label>
      {state === "error" && (
        <p className="error inline">We couldn’t reach MVTA just now. Please try again.</p>
      )}
      <button className="btn-primary" type="submit" disabled={state === "sending" || !contact.trim()}>
        {state === "sending" ? "Sending…" : "Send a new one"}
      </button>
    </form>
  );
}

export function Confirmed() {
  const [params] = useSearchParams();
  const status = readStatus(params.get("status"));
  const channel = readChannel(params.get("channel"));
  const outcome = describeOutcome(status, channel);

  return (
    <>
      <p className="crumb">Home / Get Notified / Confirm</p>
      <h1 className="title">{outcome.title}</h1>
      <p className="subtitle">{outcome.body}</p>

      {outcome.resend && <ResendForm />}

      {status === "opted_out" && (
        <p className="subtitle">
          <Link to="/subscribe">Sign up for service alerts</Link>
        </p>
      )}
      {status === "confirmed" && (
        <p className="subtitle">
          <Link to="/">See current service alerts</Link>
        </p>
      )}
    </>
  );
}
