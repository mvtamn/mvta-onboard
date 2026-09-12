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
  "That mobile number doesn\u2019t look right. Enter 10 digits, like (952) 388-3275.";

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

// Rider opt-in. The server enforces double opt-in (a confirmation SMS/email
// must be acknowledged before any alerts are sent), so a successful submit
// here means "check your phone/email to confirm", not "you're subscribed".
export function OptIn() {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [categories, setCategories] = useState<Set<Category>>(new Set(CATEGORIES));
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

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

    if (!phone.trim() && !email.trim()) {
      setStatus("error");
      setErrorMsg("Enter a mobile number, an email address, or both.");
      return;
    }
    if (!consent) {
      setStatus("error");
      setErrorMsg("Please agree to receive alerts before subscribing.");
      return;
    }

    // The API only accepts E.164, so convert what the rider typed before
    // sending; an unreadable number is named here rather than coming back as
    // an unexplained failure.
    let e164: string | undefined;
    if (phone.trim()) {
      const normalized = normalizeUsPhone(phone);
      if (!normalized) {
        setStatus("error");
        setErrorMsg(BAD_PHONE_MSG);
        return;
      }
      e164 = normalized;
      setPhone(formatE164ForDisplay(normalized));
    }

    setStatus("submitting");
    try {
      await api.subscribe({
        phone_number: e164,
        email: email.trim() || undefined,
        routes: "ALL",
        zones: "ALL",
        categories: [...categories],
        consent_source: "web_form",
      });
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrorMsg(describeSubscribeError(err));
    }
  }

  if (status === "done") {
    return (
      <>
        <h1 className="title">Check your phone or email</h1>
        <p className="subtitle">
          We&rsquo;ve sent a confirmation to the contact information you provided. Reply or click
          the link to confirm. You won&rsquo;t receive alerts until you do.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="crumb">Home / Get Notified</p>
      <h1 className="title">Get service alerts</h1>
      <p className="subtitle">
        Get texts or emails about delays, detours, and closures on the routes you ride.
      </p>

      <form className="form" onSubmit={onSubmit}>
        <label className="field">
          <span>Mobile number (for SMS)</span>
          <input
            type="tel"
            inputMode="tel"
            placeholder="(952) 388-3275"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
          />
        </label>

        <label className="field">
          <span>Email address</span>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>

        <fieldset className="field">
          <legend>Which alerts?</legend>
          <div className="checks">
            {CATEGORIES.map((c) => (
              <label key={c} className="check">
                <input
                  type="checkbox"
                  checked={categories.has(c)}
                  onChange={() => toggleCategory(c)}
                />
                {CATEGORY_LABELS[c]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="check consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
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

        {status === "error" ? <p className="error inline" role="alert">{errorMsg}</p> : null}

        <button type="submit" className="btn-primary" disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : "Subscribe"}
        </button>
      </form>
    </>
  );
}
