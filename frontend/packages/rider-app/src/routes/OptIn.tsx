import { useEffect, useMemo, useState } from "react";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
  ApiError,
  normalizeUsPhone,
  formatE164ForDisplay,
  type RiderPreferenceOption,
} from "@mvta/shared";
import { api } from "../config.js";
import { AudiencePicker, type Mode } from "../components/AudiencePicker.js";

const BAD_PHONE_MSG =
  "That mobile number doesn’t look right. Enter 10 digits, like (612) 555-0123.";

// What each category actually covers. The label alone is a word a rider has to
// guess at - "Outage" and "General" especially - and guessing wrong here means
// unticking the alerts they wanted.
const CATEGORY_WHAT: Record<Category, string> = {
  delay: "Buses running behind schedule",
  detour: "Stops moved or skipped",
  closure: "Roads, ramps or stations closed",
  outage: "Equipment or a facility out of service",
  general: "Service news that is not an incident",
  emergency: "Urgent safety information",
  demand_response_delay: "Longer waits for on-demand rides",
};

// POST /subscribers answers a 400 with a `details` array naming the fields it
// rejected. Saying which field is wrong is the difference between a rider
// fixing it and a rider giving up, so unpack it instead of reporting every
// failure as the same sentence.
function describeSubscribeError(err: unknown): { field: ErrorField; message: string } {
  const details = err instanceof ApiError ? err.details : null;
  if (err instanceof ApiError && err.status === 400 && Array.isArray(details)) {
    const named = (field: string) => details.some((d: unknown) => String(d).startsWith(field));
    if (named("phone_number")) return { field: "phone", message: BAD_PHONE_MSG };
    if (named("email")) {
      return { field: "email", message: "That email address doesn’t look right. Check it and try again." };
    }
    if (named("categories")) return { field: "categories", message: "Choose at least one kind of alert." };
    if (named("routes")) {
      return {
        field: "routes",
        message: "A route you chose is no longer offered. Reload the page and choose your routes again.",
      };
    }
  }
  if (err instanceof ApiError) {
    return {
      field: "form",
      message: "We couldn’t start your subscription. Check your contact information and try again.",
    };
  }
  return { field: "form", message: "We couldn’t start your subscription. Please try again." };
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
      <div className="panel">
        <p className="status-ok" role="status" style={{ margin: 0 }}>
          Your mobile number is confirmed. You&rsquo;ll start getting texts about delays, detours, and
          closures.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
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
          <p className="error inline">That code didn&rsquo;t work. Check it, or ask for a new one.</p>
        )}
        {state === "error" && (
          <p className="error inline">We couldn&rsquo;t reach MVTA just now. Please try again.</p>
        )}
        {resent && (
          <p className="subtitle" role="status" style={{ margin: 0 }}>
            A new code is on its way. It can take a minute to arrive.
          </p>
        )}
        <div className="actions">
          <button className="btn-primary" type="submit" disabled={state === "checking" || code.length !== 6}>
            {state === "checking" ? "Checking…" : "Confirm my number"}
          </button>
          <button className="link-btn" type="button" onClick={onResend}>
            Send me a new code
          </button>
        </div>
      </form>
    </div>
  );
}

type ChannelChoice = "text" | "email" | "both";

const CHANNEL_CHOICES: { value: ChannelChoice; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "both", label: "Both" },
];

/** Which control an error is about, so it can be marked for assistive tech. */
type ErrorField = "phone" | "email" | "categories" | "routes" | "consent" | "form";

type Errors = Partial<Record<ErrorField, string>>;

// Rider opt-in. The server enforces double opt-in (a confirmation SMS/email
// must be acknowledged before any alerts are sent), so a successful submit
// here means "check your phone/email to confirm", not "you're subscribed".
//
// The form asks four questions, each one a numbered card saying why it is
// asked, and shows the answers back beside the button: what arrives, and how
// often, is the thing a rider is deciding, and it was previously only knowable
// by reading the whole form again. Every problem is reported on the control it
// belongs to, with one live region by the button so it is also announced.
export function OptIn() {
  const [channels, setChannels] = useState<ChannelChoice>("both");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [categories, setCategories] = useState<Set<Category>>(new Set(CATEGORIES));
  // Every route unless the rider narrows it. The list comes from the API; until
  // it arrives, or if it can't, "only the routes I choose" is not offered
  // rather than offered empty, and signing up for every route still works.
  const [routeOptions, setRouteOptions] = useState<RiderPreferenceOption[] | null>(null);
  const [routeOptionsFailed, setRouteOptionsFailed] = useState(false);
  const [routeMode, setRouteMode] = useState<Mode>("all");
  const [routes, setRoutes] = useState<Set<string>>(new Set());
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [errors, setErrors] = useState<Errors>({});
  // What was actually sent, kept for the success screen: it offers to confirm
  // the texted code in place, which needs the number in the shape the API
  // stored it rather than the shape the field holds.
  const [submittedPhone, setSubmittedPhone] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const wantsText = channels !== "email";
  const wantsEmail = channels !== "text";

  useEffect(() => {
    let cancelled = false;
    api
      .getSubscribeOptions()
      .then((options) => {
        if (!cancelled) setRouteOptions(options.routes);
      })
      .catch(() => {
        if (!cancelled) setRouteOptionsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canChooseRoutes = routeOptions !== null && routeOptions.length > 0;
  const routeListMissing = routeOptionsFailed || (routeOptions !== null && routeOptions.length === 0);

  // An error is about what was on the form when it was submitted. Once the
  // rider changes something, it is stale, and leaving it up reads as if the
  // change did not help.
  function clearErrors() {
    setErrors((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }

  function toggleCategory(c: Category) {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
    clearErrors();
  }

  function toggleRoute(id: string) {
    setRoutes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    clearErrors();
  }

  /** Everything wrong with the form, so a rider fixes it in one pass. */
  function problems(): Errors {
    const found: Errors = {};
    // "Both" means both. Each message names the missing field and the choice
    // to make instead, since the rider may simply not have one of them.
    if (wantsText && !phone.trim()) {
      found.phone =
        channels === "both"
          ? "Enter your mobile number, or choose Email if you only want emails."
          : "Enter your mobile number.";
    }
    if (wantsEmail && !email.trim()) {
      found.email =
        channels === "both"
          ? "Enter your email address, or choose Text if you only want texts."
          : "Enter your email address.";
    }
    if (categories.size === 0) found.categories = "Choose at least one kind of alert.";
    if (routeMode === "some" && routes.size === 0) {
      found.routes = "Choose at least one route, or choose All routes.";
    }
    if (!consent) found.consent = "Please agree to receive alerts before subscribing.";
    return found;
  }

  const chosenRoutes = useMemo(
    () => (routeOptions ?? []).filter((option) => routes.has(option.id)),
    [routeOptions, routes],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = problems();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});

    // The API only accepts E.164, so convert what the rider typed before
    // sending; an unreadable number is named here rather than coming back as
    // an unexplained failure.
    let e164: string | undefined;
    if (wantsText) {
      const normalized = normalizeUsPhone(phone);
      if (!normalized) {
        setErrors({ phone: BAD_PHONE_MSG });
        return;
      }
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
        // In the order the list offers them, not the order they were ticked.
        routes: routeMode === "some" && routeOptions ? chosenRoutes.map((r) => r.id) : "ALL",
        zones: "ALL",
        categories: [...categories],
        consent_source: "web_form",
      });
      setSubmittedPhone(e164 ?? null);
      setSubmittedEmail(sendEmail ?? null);
      setStatus("done");
    } catch (err) {
      const { field, message } = describeSubscribeError(err);
      setStatus("idle");
      setErrors({ [field]: message });
    }
  }

  if (status === "done") {
    const heading =
      submittedPhone && submittedEmail
        ? "Check your phone and email"
        : submittedPhone
          ? "Check your phone"
          : "Check your email";
    // Numbered, because on "both" there are two separate things to do and they
    // are done in two different places.
    const steps: string[] = [];
    if (submittedPhone) {
      steps.push(`We texted a 6-digit code to ${formatE164ForDisplay(submittedPhone)}. Enter it below.`);
    }
    if (submittedEmail) {
      steps.push(`We emailed a confirmation link to ${submittedEmail}. Click it to turn emails on.`);
    }
    return (
      <>
        <p className="crumb">Home / Get Notified</p>
        <div className="done-mark" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="title">{heading}</h1>
        <p className="subtitle">
          You&rsquo;re not subscribed yet &mdash; one more step, so we know the contact is really yours.
        </p>
        <ol className="next-steps">
          {steps.map((step, index) => (
            <li key={step}>
              <span className="n">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        {/* The code box is the only way to finish the SMS channel today:
            replying to the text needs a toll-free number, which is in carrier
            verification. It is worth having regardless - a rider who is already
            looking at this tab would rather type six digits than switch apps. */}
        {submittedPhone && <SmsCodeBox phoneNumber={submittedPhone} />}
        <p className="summary-note" style={{ marginTop: 18 }}>
          Every alert we send carries a link to change or stop these &mdash; no account, no password.
        </p>
      </>
    );
  }

  // Exactly one thing is announced, never the same sentence twice. With one
  // problem that is the message on the control itself; with several it is a
  // line by the button that sends the rider back up the form, because reading
  // three sentences out in a row is not how anyone fixes a form.
  const errorCount = Object.keys(errors).length;
  const soleError = errorCount === 1;
  const describedBy = (field: ErrorField) => (errors[field] ? `optin-${field}-error` : undefined);
  const fieldError = (field: ErrorField) =>
    errors[field] ? (
      <p className="field-error" id={`optin-${field}-error`} role={soleError ? "alert" : undefined}>
        {errors[field]}
      </p>
    ) : null;

  const summaryChannel =
    channels === "both" ? "Text and email" : channels === "text" ? "Text only" : "Email only";
  const summaryCategories =
    categories.size === CATEGORIES.length
      ? `All ${CATEGORIES.length} kinds`
      : categories.size === 1
        ? "1 kind"
        : `${categories.size} kinds`;
  const summaryRoutes =
    routeMode === "all"
      ? "Every MVTA route"
      : chosenRoutes.length === 0
        ? "No routes chosen yet"
        : chosenRoutes.length === 1
          ? chosenRoutes[0].label
          : `${chosenRoutes.length} routes`;
  const confirmNote =
    channels === "both"
      ? "We’ll text a code and email a link to confirm. Nothing is sent until you do."
      : channels === "text"
        ? "We’ll text a 6-digit code to confirm. No texts are sent until you enter it."
        : "We’ll email a link to confirm. No emails are sent until you click it.";

  return (
    <>
      <p className="crumb">Home / Get Notified</p>
      <h1 className="title">Get service alerts</h1>
      <p className="subtitle">
        Delays, detours and closures on the routes you ride &mdash; by text, email, or both. Change or
        stop them any time from any alert we send.
      </p>

      <form className="form optin" onSubmit={onSubmit} noValidate>
        <div className="optin-layout">
          <div className="form optin" style={{ gap: 18 }}>
            <fieldset className={errors.phone || errors.email ? "step-card invalid" : "step-card"}>
              <div className="step-head">
                <span className="step-num" aria-hidden="true">
                  1
                </span>
                <legend className="section-title">How should we reach you?</legend>
              </div>
              <p className="step-why">We use this only to send the alerts you ask for.</p>
              <div className="step-body">
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
                          clearErrors();
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
                          clearErrors();
                        }}
                        autoComplete="tel"
                        aria-invalid={errors.phone ? true : undefined}
                        aria-describedby={describedBy("phone")}
                      />
                      {fieldError("phone")}
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
                          clearErrors();
                        }}
                        autoComplete="email"
                        aria-invalid={errors.email ? true : undefined}
                        aria-describedby={describedBy("email")}
                      />
                      {fieldError("email")}
                    </label>
                  )}
                </div>
              </div>
            </fieldset>

            <fieldset className={errors.categories ? "step-card invalid" : "step-card"}>
              <div className="step-head">
                <span className="step-num" aria-hidden="true">
                  2
                </span>
                <legend className="section-title">What should we send?</legend>
              </div>
              <p className="step-why">All of them to start. Untick anything you would rather not hear about.</p>
              <div className="step-body">
                <div className="checks described">
                  {CATEGORIES.map((c) => (
                    <label key={c} className="check described">
                      <input
                        type="checkbox"
                        checked={categories.has(c)}
                        onChange={() => toggleCategory(c)}
                        aria-describedby={`optin-what-${c}`}
                      />
                      <span>
                        <b>{CATEGORY_LABELS[c]}</b>
                        <small id={`optin-what-${c}`}>{CATEGORY_WHAT[c]}</small>
                      </span>
                    </label>
                  ))}
                </div>
                {fieldError("categories")}
              </div>
            </fieldset>

            <fieldset className={errors.routes ? "step-card invalid" : "step-card"}>
              <div className="step-head">
                <span className="step-num" aria-hidden="true">
                  3
                </span>
                <legend className="section-title">Which routes?</legend>
              </div>
              <p className="step-why">Alerts about every route, or only the ones you ride.</p>
              <div className="step-body">
                <AudiencePicker
                  variant="section"
                  legend=""
                  name="route-mode"
                  allLabel="All routes"
                  someLabel="Only the routes I choose"
                  listLabel="Routes"
                  searchPlaceholder="Search by number or place"
                  options={routeOptions ?? []}
                  mode={routeMode}
                  chosen={routes}
                  someDisabled={!canChooseRoutes}
                  note={
                    routeListMissing
                      ? "We couldn’t load the route list just now. You can sign up for all routes, then choose yours from the link in any alert email."
                      : undefined
                  }
                  onMode={(mode) => {
                    setRouteMode(mode);
                    clearErrors();
                  }}
                  onToggle={toggleRoute}
                  onClear={() => {
                    setRoutes(new Set());
                    clearErrors();
                  }}
                />
                {fieldError("routes")}
              </div>
            </fieldset>

            <div className="section">
              <label className={errors.consent ? "check consent invalid" : "check consent"}>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => {
                    setConsent(e.target.checked);
                    clearErrors();
                  }}
                  aria-invalid={errors.consent ? true : undefined}
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
              {fieldError("consent")}
            </div>
          </div>

          <aside className="summary">
            <h2>Your alerts</h2>
            <dl>
              <div>
                <dt>How</dt>
                <dd>{summaryChannel}</dd>
              </div>
              <div>
                <dt>What</dt>
                <dd>{summaryCategories}</dd>
              </div>
              <div>
                <dt>Where</dt>
                <dd>{summaryRoutes}</dd>
              </div>
            </dl>
            {errors.form && (
              <p className="form-error" id="optin-form-error" role={soleError ? "alert" : undefined}>
                {errors.form}
              </p>
            )}
            <button type="submit" className="btn-primary submit" disabled={status === "submitting"}>
              {status === "submitting" ? "Subscribing…" : "Subscribe"}
            </button>
            {errorCount > 1 && (
              <p className="form-error" role="alert">
                Check the highlighted answers above.
              </p>
            )}
            <p className="summary-note">{confirmNote}</p>
          </aside>
        </div>
      </form>
    </>
  );
}
