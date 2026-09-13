import { useState } from "react";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
  ApiError,
  normalizeUsPhone,
  formatE164ForDisplay,
} from "@mvta/shared";
import { api } from "../config.js";

const BAD_PHONE_MSG =
  "That mobile number doesn\u2019t look right. Enter 10 digits, like (612) 555-0123.";

// POST /subscribers answers a 400 with a `details` array naming the fields it
// rejected. Saying which field is wrong is the difference between a rider
// fixing it and a rider giving up, so unpack it instead of reporting every
// failure as the same sentence.
function describeSubscribeError(err: unknown): string {
  const details = err instanceof ApiError ? err.details : null;
  if (err instanceof ApiError && err.status === 400 && Array.isArray(details)) {
    const named = (field: string) =>
      details.some((d: unknown) => String(d).startsWith(field));
    if (named("phone_number")) return BAD_PHONE_MSG;
    if (named("email")) return "That email address doesn\u2019t look right. Check it and try again.";
    if (named("categories")) return "Choose at least one kind of alert.";
  }
  if (err instanceof ApiError) {
    return "We couldn\u2019t start your subscription. Check your contact information and try again.";
  }
  return "We couldn\u2019t start your subscription. Please try again.";
}

// Confirming the texted code without leaving the page.
//
// `POST /api/subscribers/confirm-sms` answers `confirmed` or `invalid` and
// nothing else - it takes a phone number from anyone, so saying "expired" or
// "too many attempts" would tell whoever typed one whether it is mid-signup.
// The remedy for every `invalid` is the same, which is why one sentence covers
// all of them and why the resend sits beside it.
function SmsCodeBox({ phoneNumber }: { phoneNumber: string }) {
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "confirmed" | "wrong" | "error">("idle");
  const [resent, setResent] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setState("checking");
    try {
      const result = await api.confirmSms({ phone_number: phoneNumber, code: code.trim() });
      setState(result.status === "confirmed" ? "confirmed" : "wrong");
    } catch {
      setState("error");
    }
  }

  async function onResend() {
    setResent(false);
    try {
      await api.resendConfirmation({ phone_number: phoneNumber });
      // This page knows a confirmation is waiting, because it just created
      // one - so it can say so plainly, where the landing page reached from an
      // email link cannot.
      setResent(true);
      setCode("");
      setState("idle");
    } catch {
      setState("error");
    }
  }

  if (state === "confirmed") {
    return (
      <p className="subtitle" role="status">
        Your mobile number is confirmed. You&rsquo;ll start getting texts about delays, detours,
        and closures.
      </p>
    );
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field">
        <span>Enter the 6-digit code we texted you</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
        />
      </label>
      {state === "wrong" && (
        <p className="error inline">
          That code didn&rsquo;t work. Check it, or ask for a new one.
        </p>
      )}
      {state === "error" && (
        <p className="error inline">We couldn&rsquo;t reach MVTA just now. Please try again.</p>
      )}
      {resent && (
        <p className="subtitle" role="status">
          A new code is on its way. It can take a minute to arrive.
        </p>
      )}
      <button className="btn-primary" type="submit" disabled={state === "checking" || code.length !== 6}>
        {state === "checking" ? "Checking…" : "Confirm my number"}
      </button>
      <button className="retry-btn" type="button" onClick={onResend}>
        Send me a new code
      </button>
    </form>
  );
}

type ChannelChoice = "text" | "email" | "both";

const CHANNEL_CHOICES: { value: ChannelChoice; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "both", label: "Both" },
];

/** Which control an error is about, so it can be marked for assistive tech. */
type ErrorField = "phone" | "email" | "consent" | null;

// Rider opt-in. The server enforces double opt-in (a confirmation SMS/email
// must be acknowledged before any alerts are sent), so a successful submit
// here means "check your phone/email to confirm", not "you're subscribed".
//
// The rider says how they want alerts before giving contact details, and only
// the fields for that choice are shown or sent. It used to be implied by which
// boxes happened to be filled in, which made "both" an accident rather than a
// decision and left a rider who only wanted email looking at a phone field.
export function OptIn() {
  const [channels, setChannels] = useState<ChannelChoice>("both");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [categories, setCategories] = useState<Set<Category>>(new Set(CATEGORIES));
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [errorField, setErrorField] = useState<ErrorField>(null);
  // What was actually sent, kept for the success screen: it offers to confirm
  // the texted code in place, which needs the number in the shape the API
  // stored it rather than the shape the field holds.
  const [submittedPhone, setSubmittedPhone] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const wantsText = channels !== "email";
  const wantsEmail = channels !== "text";

  function fail(message: string, field: ErrorField) {
    setStatus("error");
    setErrorMsg(message);
    setErrorField(field);
  }

  // An error is about what was on the form when it was submitted. Once the
  // rider changes something, it is stale, and leaving it up reads as if the
  // change did not help.
  function clearError() {
    if (status !== "error") return;
    setStatus("idle");
    setErrorMsg("");
    setErrorField(null);
  }

  function toggleCategory(c: Category) {
    setCategories((prev) => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    setErrorField(null);

    // "Both" means both. Each message names the missing field and the choice
    // to make instead, since the rider may simply not have one of them.
    if (wantsText && !phone.trim()) {
      return fail(
        channels === "both"
          ? "Enter your mobile number, or choose Email if you only want emails."
          : "Enter your mobile number.",
        "phone",
      );
    }
    if (wantsEmail && !email.trim()) {
      return fail(
        channels === "both"
          ? "Enter your email address, or choose Text if you only want texts."
          : "Enter your email address.",
        "email",
      );
    }
    if (categories.size === 0) {
      return fail("Choose at least one kind of alert.", null);
    }
    if (!consent) {
      return fail("Please agree to receive alerts before subscribing.", "consent");
    }

    // The API only accepts E.164, so convert what the rider typed before
    // sending; an unreadable number is named here rather than coming back as
    // an unexplained failure.
    let e164: string | undefined;
    if (wantsText) {
      const normalized = normalizeUsPhone(phone);
      if (!normalized) return fail(BAD_PHONE_MSG, "phone");
      e164 = normalized;
      setPhone(formatE164ForDisplay(normalized));
    }

    // Only the chosen channels are sent. A number typed before switching to
    // Email is not: the rider has since said they do not want texts, and
    // sending it anyway would start a text subscription they took back.
    const sendEmail = wantsEmail ? email.trim() : undefined;

    setStatus("submitting");
    try {
      await api.subscribe({
        phone_number: e164,
        email: sendEmail,
        routes: "ALL",
        zones: "ALL",
        categories: [...categories],
        consent_source: "web_form",
      });
      setSubmittedPhone(e164 ?? null);
      setSubmittedEmail(sendEmail ?? null);
      setStatus("done");
    } catch (err) {
      const message = describeSubscribeError(err);
      fail(message, message === BAD_PHONE_MSG ? "phone" : message.startsWith("That email") ? "email" : null);
    }
  }

  if (status === "done") {
    const heading =
      submittedPhone && submittedEmail
        ? "Check your phone and email"
        : submittedPhone
          ? "Check your phone"
          : "Check your email";
    return (
      <>
        <h1 className="title">{heading}</h1>
        <p className="subtitle">
          We&rsquo;ve sent a confirmation to the contact information you provided.
          {submittedEmail ? " Click the link in the email to confirm it." : ""}
          {" "}You won&rsquo;t receive alerts until you do.
        </p>
        {/* The code box is the only way to finish the SMS channel today:
            replying to the text needs a toll-free number, which is in carrier
            verification. It is worth having regardless - a rider who is already
            looking at this tab would rather type six digits than switch apps. */}
        {submittedPhone && <SmsCodeBox phoneNumber={submittedPhone} />}
      </>
    );
  }

  const describedBy = (field: ErrorField) => (errorField === field ? "optin-error" : undefined);

  return (
    <>
      <p className="crumb">Home / Get Notified</p>
      <h1 className="title">Get service alerts</h1>
      <p className="subtitle">
        Get texts or emails about delays, detours, and closures on the routes you ride.
      </p>

      <form className="form optin" onSubmit={onSubmit} noValidate>
        <fieldset className="section">
          <legend className="section-title">How do you want alerts?</legend>
          <div className="segments">
            {CHANNEL_CHOICES.map((choice) => (
              <label key={choice.value} className="segment">
                <input
                  type="radio"
                  name="channels"
                  value={choice.value}
                  checked={channels === choice.value}
                  onChange={() => {
                    setChannels(choice.value);
                    clearError();
                  }}
                />
                <span>{choice.label}</span>
              </label>
            ))}
          </div>

          <div className="contact-fields">
            {wantsText && (
              <label className="field">
                <span>Mobile number</span>
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="(612) 555-0123"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    clearError();
                  }}
                  autoComplete="tel"
                  aria-invalid={errorField === "phone" || undefined}
                  aria-describedby={describedBy("phone")}
                />
              </label>
            )}
            {wantsEmail && (
              <label className="field">
                <span>Email address</span>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    clearError();
                  }}
                  autoComplete="email"
                  aria-invalid={errorField === "email" || undefined}
                  aria-describedby={describedBy("email")}
                />
              </label>
            )}
          </div>
        </fieldset>

        <fieldset className="section">
          <legend className="section-title">Which alerts?</legend>
          <div className="checks grid">
            {CATEGORIES.map((c) => (
              // A label too long for one grid cell spans two, which keeps
              // every row full instead of leaving a short ragged last row.
              <label key={c} className={CATEGORY_LABELS[c].length > 14 ? "check wide" : "check"}>
                <input
                  type="checkbox"
                  checked={categories.has(c)}
                  onChange={() => {
                    toggleCategory(c);
                    clearError();
                  }}
                />
                <span>{CATEGORY_LABELS[c]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="section">
          <label className="check consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                clearError();
              }}
              aria-invalid={errorField === "consent" || undefined}
              aria-describedby={describedBy("consent")}
            />
            <span>
              I agree to receive automated service alerts from MVTA. Message and data rates may
              apply. Reply STOP to unsubscribe, HELP for help. See MVTA&rsquo;s{" "}
              <a href="https://www.mvta.com/rider-alerts-policy/" target="_blank" rel="noopener noreferrer">
                Terms &amp; Conditions
              </a>{" "}
              and{" "}
              <a href="https://www.mvta.com/privacy-and-security-policy/" target="_blank" rel="noopener noreferrer">
                Privacy Policy
              </a>
              .
            </span>
          </label>

          {status === "error" ? (
            <p id="optin-error" className="form-error" role="alert">
              {errorMsg}
            </p>
          ) : null}

          <button type="submit" className="btn-primary submit" disabled={status === "submitting"}>
            {status === "submitting" ? "Subscribing…" : "Subscribe"}
          </button>
        </div>
      </form>
    </>
  );
}
