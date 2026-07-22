import { useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, type Category, ApiError } from "@mvta/shared";
import { api } from "../config.js";

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

    setStatus("submitting");
    try {
      await api.subscribe({
        phone_number: phone.trim() || undefined,
        email: email.trim() || undefined,
        routes: "ALL",
        zones: "ALL",
        categories: [...categories],
        consent_source: "web_form",
      });
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    }
  }

  if (status === "done") {
    return (
      <>
        <h1 className="title">Almost there</h1>
        <p className="subtitle">
          We&rsquo;ve sent a confirmation to the contact info you provided. Reply or click
          the link to confirm &mdash; you won&rsquo;t receive alerts until you do.
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
            placeholder="+1 612 555 0142"
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
            apply. Reply STOP to unsubscribe, HELP for help.
          </span>
        </label>

        {status === "error" ? <p className="error inline">{errorMsg}</p> : null}

        <button type="submit" className="btn-primary" disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : "Subscribe"}
        </button>
      </form>
    </>
  );
}
