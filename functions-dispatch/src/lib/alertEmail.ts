import { escapeHtml } from "./html";

// What an email to a rider says, and where it sends them to manage it.
// Increment D of plans/rider-preference-management-spec.md.
//
// Here rather than in the functions that send, because this package only runs
// dist/src/lib/*.test.js, and the footer is the part of an alert email that
// carries a credential.

/** The rider app's base, if it is a plain https origin-and-path; see manageLinkFor. */
function usableBase(baseUrl: string | undefined): string | null {
  const base = (baseUrl ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?$/.test(base) ? base : null;
}

/**
 * The link to a rider's own subscription.
 *
 * THE KEY RIDES IN THE FRAGMENT (`#key=`), NOT THE QUERY STRING. A fragment is
 * never sent to any server: not in the request for the page, not to Front Door
 * or Static Web Apps logs, not in a Referer header. `?key=` would put a
 * credential that does not expire into every access log the moment a rider
 * clicked. The rider app reads it from the fragment and removes it.
 *
 * Returns null rather than a degraded link. An email is read far from the app,
 * so a relative link goes nowhere - and a footer that looks like a working
 * opt-out but is not is worse than no footer, because nobody notices it is
 * broken. The base must be https (a key over plain http is a key on the wire)
 * and must be a plain origin-and-path, so nothing it contains can break out of
 * the href it is placed in.
 */
export function manageLinkFor(baseUrl: string | undefined, manageKey: string | null | undefined): string | null {
  const base = usableBase(baseUrl);
  if (!base) return null;
  if (!manageKey || !/^[0-9a-f]{64}$/.test(manageKey)) return null;
  return `${base}/subscribe/preferences#key=${manageKey}`;
}

/**
 * The one-click unsubscribe address for one delivered email (RFC 8058).
 *
 * Mail clients POST to this URL themselves, with no page and no rider in
 * front of them, so the URL has to carry its own proof. It carries the
 * delivery's log id, NOT the manage key: this one is in the query string, and
 * so in access logs, and all it can do is stop email to the address it was
 * sent to - the one thing its recipient is asking for. The manage key would
 * hand whoever read a log line the rider's whole subscription.
 *
 * Same base rule as manageLinkFor, and null for the same reason: a header that
 * points nowhere is an unsubscribe that silently fails.
 */
export function oneClickUnsubscribeUrl(baseUrl: string | undefined, deliveryId: string): string | null {
  const base = usableBase(baseUrl);
  if (!base) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deliveryId)) return null;
  return `${base}/api/subscribers/one-click-unsubscribe?d=${deliveryId.toLowerCase()}`;
}

/**
 * The headers that put an Unsubscribe button in Gmail, Yahoo and Outlook.
 * Bulk senders without them are filtered harder; the footer link alone does
 * not count.
 */
export function unsubscribeHeaders(oneClickUrl: string | null): Record<string, string> {
  if (!oneClickUrl) return {};
  return {
    "List-Unsubscribe": `<${oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export interface EmailParts {
  subject: string;
  text: string;
  html: string;
}

const WHY = "You’re receiving this because you signed up for MVTA service alerts.";

/**
 * A service alert, with the footer that lets the rider change or stop it.
 *
 * Without a link the footer still says why the email arrived, but offers no
 * opt-out it cannot deliver; the caller logs that the link was missing.
 */
export function buildAlertEmail(summary: string, manageLink: string | null): EmailParts {
  const subject = "MVTA Service Alert";
  const footerStyle = "color:#4f4f4f;font-size:12px;line-height:1.5";
  const rule = '<hr style="border:none;border-top:1px solid #e3e1da;margin:24px 0 12px">';

  if (!manageLink) {
    return {
      subject,
      text: `${summary}\n\n${WHY}`,
      html: `<p>${escapeHtml(summary)}</p>${rule}<p style="${footerStyle}">${escapeHtml(WHY)}</p>`,
    };
  }
  return {
    subject,
    text: `${summary}\n\n${WHY}\nManage your alerts or unsubscribe: ${manageLink}`,
    html:
      `<p>${escapeHtml(summary)}</p>${rule}` +
      `<p style="${footerStyle}">${escapeHtml(WHY)}<br>` +
      `<a href="${escapeHtml(manageLink)}">Manage your alerts or unsubscribe</a></p>`,
  };
}

/** The reply to a rider who asked for their manage link again. */
export function buildManageLinkEmail(manageLink: string): EmailParts {
  const note = "If you didn’t ask for this, you can ignore it. Your alerts haven’t changed.";
  return {
    subject: "Your link to manage MVTA alerts",
    text: `Here’s the link to manage your MVTA service alerts or unsubscribe:\n${manageLink}\n\n${note}`,
    html:
      "<p>Here’s the link to manage your MVTA service alerts or unsubscribe:</p>" +
      `<p><a href="${escapeHtml(manageLink)}">Manage your alerts</a></p>` +
      `<p style="color:#4f4f4f;font-size:12px">${escapeHtml(note)}</p>`,
  };
}

/** The same, by text. Short, because every character is a cost on every send. */
export function buildManageLinkSms(manageLink: string): string {
  return `MVTA alerts: manage your alerts or unsubscribe here: ${manageLink}`;
}
