import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ApiError,
  CATEGORIES,
  CATEGORY_LABELS,
  normalizeUsPhone,
  type Category,
  type RiderPreferenceOption,
  type RiderPreferences,
} from "@mvta/shared";
import { api } from "../config.js";
import { AudiencePicker, type Mode } from "../components/AudiencePicker.js";

// A rider managing their own subscription, reached from the link in an alert
// email. Increment C of plans/rider-preference-management-spec.md.
//
// THE KEY ARRIVES IN THE FRAGMENT AND LEAVES THE ADDRESS BAR AT ONCE. The link
// carries #key=, never ?key=: a fragment is not part of the request the browser
// makes for this page, so it never reaches Front Door's or Static Web Apps'
// access logs, and it is not sent in a Referer. It is read once, kept, and then
// removed from the URL so it is not left where it can be screenshotted or
// pasted into a support ticket. It is kept in sessionStorage rather than only
// in memory so a reload does not send the rider back through recovery for a
// link they already hold. The storage is scoped to this tab and dies with it.

export const MANAGE_KEY_STORAGE = "mvta.manageKey";

/** The shape migration 119 issues. Anything else is not worth a request. */
function looksLikeKey(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * The key from the link's fragment, `#key=...`.
 *
 * `undefined` means the link carried no key; `null` means it carried something
 * that is not a key - a link cut short by a mail program, usually. A `?key=`
 * query string is deliberately not read: no link has ever been sent that way,
 * and honouring it would invite a format that puts the key in access logs.
 */
export function keyFromHash(hash: string): string | null | undefined {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  if (!params.has("key")) return undefined;
  const value = params.get("key") ?? "";
  return looksLikeKey(value) ? value : null;
}

function remember(key: string) {
  try {
    sessionStorage.setItem(MANAGE_KEY_STORAGE, key);
  } catch {
    /* storage can be unavailable; the key still works for this visit */
  }
}

function recall(): string | null {
  try {
    const stored = sessionStorage.getItem(MANAGE_KEY_STORAGE);
    return stored && looksLikeKey(stored) ? stored : null;
  } catch {
    return null;
  }
}

function forget() {
  try {
    sessionStorage.removeItem(MANAGE_KEY_STORAGE);
  } catch {
    /* nothing to do */
  }
}

type View =
  | { kind: "no_key" }
  | { kind: "loading" }
  | { kind: "ready"; prefs: RiderPreferences }
  | { kind: "not_found" }
  | { kind: "unsubscribed" }
  | { kind: "error" };

export function Preferences() {
  const location = useLocation();
  const navigate = useNavigate();

  // Read exactly once. A link the rider just opened is what they meant, so a
  // malformed ?key= does NOT fall back to a key stored from an earlier visit -
  // that one could belong to a different subscription.
  const [key] = useState<string | null>(() => {
    const fromLink = keyFromHash(location.hash);
    if (fromLink !== undefined) {
      if (fromLink === null) return null;
      remember(fromLink);
      return fromLink;
    }
    return recall();
  });

  useEffect(() => {
    if (keyFromHash(location.hash) !== undefined) {
      navigate(location.pathname + location.search, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate]);

  const [view, setView] = useState<View>(key ? { kind: "loading" } : { kind: "no_key" });
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(async () => {
    if (!key) return;
    try {
      const prefs = await api.getPreferences(key);
      // An opted-out subscription is shown as such rather than as a form: a
      // save would be refused, and coming back is a new consent a link cannot
      // give.
      setView(prefs.status === "opted_out" ? { kind: "unsubscribed" } : { kind: "ready", prefs });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        forget();
        setView({ kind: "not_found" });
      } else {
        setView({ kind: "error" });
      }
    }
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <p className="crumb">Home / Get Notified / Manage</p>
      {view.kind === "loading" && <p className="loading">Loading your alerts…</p>}

      {view.kind === "no_key" && (
        <>
          <h1 className="title">Open your link from an MVTA alert</h1>
          <p className="subtitle">
            To change your alerts, use the link at the bottom of your most recent MVTA alert email.
            If you opened one and ended up here, your mail program may have cut the link short. We can
            send you the link again.
          </p>
          <ManageLinkForm />
          <p className="subtitle">
            <Link to="/subscribe">Sign up for service alerts</Link>
          </p>
        </>
      )}

      {view.kind === "not_found" && (
        <>
          <h1 className="title">This link no longer works</h1>
          <p className="subtitle">
            A link stops working once you unsubscribe with it. If you&rsquo;re still getting alerts, we
            can send you a new one. Otherwise, sign up again.
          </p>
          <ManageLinkForm />
          <p className="subtitle">
            <Link to="/subscribe">Sign up for service alerts</Link>
          </p>
        </>
      )}

      {view.kind === "unsubscribed" && (
        <>
          <h1 className="title">You’ve unsubscribed from MVTA alerts</h1>
          <p className="subtitle">
            We won’t send you service alerts. If you’d like them again, you’ll need to sign up and
            confirm again.
          </p>
          <p className="subtitle">
            <Link to="/subscribe">Sign up for service alerts</Link>
          </p>
        </>
      )}

      {view.kind === "error" && (
        <>
          <h1 className="title">We couldn’t reach MVTA</h1>
          <p className="subtitle">This is on our side, not yours. Please try again in a moment.</p>
          <button
            className="btn-primary"
            type="button"
            onClick={() => {
              setView({ kind: "loading" });
              void load();
            }}
          >
            Try again
          </button>
        </>
      )}

      {view.kind === "ready" && key && (
        <>
          <h1 className="title">Your MVTA service alerts</h1>
          <p className="subtitle">Choose what you hear about, and how.</p>
          <PreferencesForm
            // Remount on fresh data, so the form never shows state the server
            // did not store.
            key={JSON.stringify(view.prefs)}
            prefs={view.prefs}
            manageKey={key}
            justSaved={justSaved}
            onEdited={() => setJustSaved(false)}
            onSaved={async () => {
              await load();
              setJustSaved(true);
            }}
            onOptedOut={() => setView({ kind: "unsubscribed" })}
            onGone={() => {
              forget();
              setView({ kind: "not_found" });
            }}
            onUnsubscribed={() => {
              // The server rotated the key, so the one we hold is dead.
              forget();
              setView({ kind: "unsubscribed" });
            }}
          />
        </>
      )}
    </>
  );
}

// Sending the link again, for a rider who does not have it.
//
// The acknowledgement is the same whatever the server found, because the
// endpoint answers the same to everyone - so the sentence promises nothing
// about whether that contact is subscribed. Only a confirmed contact is ever
// sent a link, which is why the sentence says "confirmed".
function ManageLinkForm() {
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const typed = contact.trim();
    if (!typed) return;
    setState("sending");
    // An "@" is the only signal available. A number that cannot be read is
    // sent as typed and simply matches nothing, which answers like everything
    // else.
    const phone = typed.includes("@") ? null : normalizeUsPhone(typed);
    try {
      await api.requestManageLink(phone ? { phone_number: phone } : { email: typed });
      setState("sent");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <p className="subtitle" role="status">
        If that contact has confirmed MVTA alerts, we&rsquo;ve sent it a link. It can take a minute to
        arrive.
      </p>
    );
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label className="field">
        <span>Send my link to this mobile number or email address</span>
        <input
          type="text"
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          placeholder="(612) 555-0123 or you@example.com"
          autoComplete="email"
        />
      </label>
      {state === "error" && (
        <p className="error inline" role="alert">
          We couldn&rsquo;t reach MVTA just now. Please try again.
        </p>
      )}
      <button className="btn-primary" type="submit" disabled={state === "sending" || !contact.trim()}>
        {state === "sending" ? "Sending…" : "Send me my link"}
      </button>
    </form>
  );
}

interface FormProps {
  prefs: RiderPreferences;
  manageKey: string;
  justSaved: boolean;
  onEdited: () => void;
  onSaved: () => Promise<void>;
  onOptedOut: () => void;
  onGone: () => void;
  onUnsubscribed: () => void;
}

/** Stored choices split into what is still offered and what is not. */
function splitChoice(stored: string[] | "ALL", offered: RiderPreferenceOption[]) {
  const ids = new Set(offered.map((o) => o.id));
  const list = stored === "ALL" ? [] : stored;
  return {
    mode: (stored === "ALL" ? "all" : "some") as Mode,
    chosen: new Set(list.filter((id) => ids.has(id))),
    dropped: list.filter((id) => !ids.has(id)),
  };
}

function PreferencesForm({ prefs, manageKey, justSaved, onEdited, onSaved, onOptedOut, onGone, onUnsubscribed }: FormProps) {
  const [categories, setCategories] = useState<Set<Category>>(
    () => new Set(prefs.categories.filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c))),
  );

  const initialRoutes = splitChoice(prefs.routes, prefs.options.routes);
  const [routeMode, setRouteMode] = useState<Mode>(initialRoutes.mode);
  const [routes, setRoutes] = useState<Set<string>>(initialRoutes.chosen);

  const offersZones = prefs.options.zones.length > 0;
  const initialZones = splitChoice(prefs.zones, prefs.options.zones);
  const [zoneMode, setZoneMode] = useState<Mode>(initialZones.mode);
  const [zones, setZones] = useState<Set<string>>(initialZones.chosen);

  // A stopped channel is shown, but cannot be switched back on from here. The
  // API refuses it (a stopped channel needs fresh consent to resume, which a
  // link from an old email is not), so the checkbox is disabled rather than
  // offering a save that would be turned down. Signing up again is the path
  // that works, and it does restore delivery.
  const smsStopped = prefs.sms_status === "unsubscribed";
  const emailStopped = prefs.email_status === "unsubscribed";
  const [keepSms, setKeepSms] = useState(prefs.has_sms && !smsStopped);
  const [keepEmail, setKeepEmail] = useState(prefs.has_email && !emailStopped);

  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingUnsubscribe, setConfirmingUnsubscribe] = useState(false);

  function edited() {
    setProblem(null);
    onEdited();
  }

  function toggle<T>(set: Set<T>, value: T, apply: (next: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
    edited();
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    // The server refuses each of these too. Checking here first is so the
    // rider is told in words, before anything is sent, and never so that an
    // empty list quietly becomes "all" or "none".
    if (categories.size === 0) {
      setProblem("Choose at least one kind of alert. To stop every alert, use Unsubscribe below.");
      return;
    }
    if (routeMode === "some" && routes.size === 0) {
      setProblem("Choose at least one route, or pick All routes.");
      return;
    }
    if (offersZones && zoneMode === "some" && zones.size === 0) {
      setProblem("Choose at least one zone, or pick All zones.");
      return;
    }
    const channels: ("sms" | "email")[] = [];
    if (prefs.has_sms && !smsStopped && keepSms) channels.push("sms");
    if (prefs.has_email && !emailStopped && keepEmail) channels.push("email");
    if (channels.length === 0) {
      // A save with no channels would opt the rider out but leave this link
      // working; Unsubscribe also retires the link and records why.
      setProblem("To stop every alert, use Unsubscribe below.");
      return;
    }

    setSaving(true);
    try {
      await api.updatePreferences(manageKey, {
        categories: CATEGORIES.filter((c) => categories.has(c)),
        routes: routeMode === "all" ? "ALL" : prefs.options.routes.map((r) => r.id).filter((id) => routes.has(id)),
        // No zone version active means no zone choice was offered; send back
        // exactly what was stored rather than inventing a new preference.
        zones: !offersZones
          ? prefs.zones
          : zoneMode === "all"
            ? "ALL"
            : prefs.options.zones.map((z) => z.id).filter((id) => zones.has(id)),
        channels,
      });
      await onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) onOptedOut();
      else if (err instanceof ApiError && err.status === 404) onGone();
      else if (err instanceof ApiError && err.status === 400) {
        setProblem("That didn’t save. Check your choices and try again.");
      } else {
        setProblem("We couldn’t reach MVTA just now. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function onUnsubscribe() {
    setSaving(true);
    try {
      await api.unsubscribeWithManageKey(manageKey);
      onUnsubscribed();
    } catch {
      setProblem("We couldn’t reach MVTA just now, so you are still subscribed. Please try again.");
      setSaving(false);
    }
  }

  return (
    <>
      <form className="form" onSubmit={onSubmit}>
        <fieldset className="field">
          <legend>How we reach you</legend>
          <div className="radios">
            {prefs.has_sms && (
              <ChannelCheck
                label={`Texts to ${prefs.phone ?? "your phone"}`}
                checked={keepSms}
                stopped={smsStopped}
                pending={prefs.sms_status === "pending_confirmation"}
                stoppedNote="Texts are stopped. To get them again, sign up again."
                onChange={() => {
                  setKeepSms((v) => !v);
                  edited();
                }}
              />
            )}
            {prefs.has_email && (
              <ChannelCheck
                label={`Emails to ${prefs.email ?? "your email"}`}
                checked={keepEmail}
                stopped={emailStopped}
                pending={prefs.email_status === "pending_confirmation"}
                stoppedNote="Emails are stopped. To get them again, sign up again."
                onChange={() => {
                  setKeepEmail((v) => !v);
                  edited();
                }}
              />
            )}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>Which alerts?</legend>
          <div className="checks">
            {CATEGORIES.map((c) => (
              <label key={c} className="check">
                <input type="checkbox" checked={categories.has(c)} onChange={() => toggle(categories, c, setCategories)} />
                {CATEGORY_LABELS[c]}
              </label>
            ))}
          </div>
        </fieldset>

        <AudiencePicker
          legend="Which routes?"
          name="route-mode"
          allLabel="All routes"
          someLabel="Only the routes I choose"
          listLabel="Routes"
          options={prefs.options.routes}
          mode={routeMode}
          chosen={routes}
          dropped={initialRoutes.dropped}
          droppedNote="Some routes you chose before no longer run, so they’ve been taken off your list."
          onMode={(m) => {
            setRouteMode(m);
            edited();
          }}
          onToggle={(id) => toggle(routes, id, setRoutes)}
        />

        {offersZones && (
          <AudiencePicker
            legend="Which MVTA Connect zones?"
            name="zone-mode"
            allLabel="All zones"
            someLabel="Only the zones I choose"
            listLabel="Zones"
            options={prefs.options.zones}
            mode={zoneMode}
            chosen={zones}
            dropped={initialZones.dropped}
            droppedNote="Some zones you chose before are no longer in service, so they’ve been taken off your list."
            onMode={(m) => {
              setZoneMode(m);
              edited();
            }}
            onToggle={(id) => toggle(zones, id, setZones)}
          />
        )}

        {problem && (
          <p className="error inline" role="alert">
            {problem}
          </p>
        )}

        <div className="actions">
          <button className="btn-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          {/* Beside the button, not at the top of the page. The form is long,
              so a rider pressing Save is scrolled well past the heading, and a
              confirmation rendered up there was invisible from where they
              clicked - the save worked and looked like it had not. */}
          {justSaved && !saving && (
            <p className="status-ok" role="status">
              Saved. Your changes apply to the next alert we send.
            </p>
          )}
        </div>
      </form>

      <section className="danger-zone" aria-label="Unsubscribe">
        {!confirmingUnsubscribe ? (
          <button className="btn-secondary" type="button" onClick={() => setConfirmingUnsubscribe(true)}>
            Unsubscribe from all MVTA alerts
          </button>
        ) : (
          <>
            <p className="note">This stops every text and email from MVTA service alerts.</p>
            <div className="actions">
              <button className="btn-primary" type="button" disabled={saving} onClick={() => void onUnsubscribe()}>
                Yes, unsubscribe
              </button>
              <button className="btn-secondary" type="button" onClick={() => setConfirmingUnsubscribe(false)}>
                Keep my alerts
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}

function ChannelCheck(props: {
  label: string;
  checked: boolean;
  stopped: boolean;
  pending: boolean;
  stoppedNote: string;
  onChange: () => void;
}) {
  return (
    <div>
      <label className="check">
        <input type="checkbox" checked={props.checked && !props.stopped} disabled={props.stopped} onChange={props.onChange} />
        {props.label}
      </label>
      {props.stopped && <p className="note">{props.stoppedNote}</p>}
      {!props.stopped && props.pending && <p className="note">Waiting for you to confirm.</p>}
    </div>
  );
}
