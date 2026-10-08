import type { ReactNode } from "react";
import { Link, Outlet } from "react-router-dom";
import { roleLabel } from "../../auth/roles.js";
import { AccessProvider, initials, isPrivileged, useAccess } from "./accessData.js";
import "./accessManagement.css";

const stroke = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

const paths = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  userPlus: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  warn: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6 9 17l-5-5" />,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  approve: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
  pulse: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  layers: <><path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" /></>,
  cpu: <><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" /></>,
  wrench: <path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L2 19l3 3 7.1-7.1a4 4 0 0 0 5.6-5.6l-2.8 2.8-2.1-2.1Z" />,
  refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>,
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return <svg {...stroke} width={size} height={size}>{paths[name]}</svg>;
}

// Every Access & Identity page sits inside this: one load, one place for
// the section-wide error and success lines, and the setup-mode warning.
export function AccessLayout() {
  return <AccessProvider><AccessFrame /></AccessProvider>;
}

function AccessFrame() {
  const { error, notice, setNotice, accessAdminFallback } = useAccess();
  return <div className="am">
    {accessAdminFallback ? <p className="am-callout attn" role="status"><Icon name="warn" /><span><b>Temporary setup mode is on.</b> Operations Administrators can manage access until Access Administrators are assigned. Remove this setting after verification.</span></p> : null}
    {error ? <p className="am-callout bad" role="alert"><Icon name="warn" /><span>{error}</span></p> : null}
    {notice ? <p className="am-callout ok" role="status"><Icon name="check" /><span className="am-grow">{notice}</span><button type="button" className="am-btn ghost sm" onClick={() => setNotice(null)}>Dismiss</button></p> : null}
    <Outlet />
  </div>;
}

export function PageHead({ title, description, actions }: { title: string; description: ReactNode; actions?: ReactNode }) {
  const { environment } = useAccess();
  return <header className="am-head">
    <div>
      <span className="am-eyebrow">ACCESS &amp; IDENTITY{environment ? ` · ${environment.toUpperCase()}` : ""}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
    {actions ? <div className="am-head-actions">{actions}</div> : null}
  </header>;
}

export function AddAccessLink() {
  return <Link className="am-btn primary" to="/admin/access/add"><Icon name="userPlus" />Add access</Link>;
}

/**
 * The access API answers 503 until migrations 129-131 are applied. Every page
 * that reads OnBoard's own roles and grants says so the same way: as a state of
 * the environment, not as a failure of the page.
 */
export function SetupNotice({ message }: { message: string }) {
  return <p className="am-callout attn" role="status"><Icon name="warn" /><span>
    <b>OnBoard’s roles are not set up in this environment yet.</b> {message}
  </span></p>;
}

/** A Role OnBoard owns, named as the Roles page names it. */
export function GrantChip({ name, privileged }: { name: string; privileged?: boolean }) {
  return <span className={`am-role${privileged ? " priv" : ""}`} title={privileged ? `${name} · granting or removing this needs a second Access Administrator` : name}>
    {privileged ? <Icon name="lock" size={11} /> : null}{name}
  </span>;
}

export function RoleChip({ role }: { role: string }) {
  const privileged = isPrivileged(role);
  return <span className={`am-role${privileged ? " priv" : ""}`} title={privileged ? `${role} · changes need a second Access Administrator` : role}>
    {privileged ? <Icon name="lock" size={11} /> : null}{roleLabel(role)}
  </span>;
}

export type Tone = "ok" | "warn" | "bad" | "info" | "mute";

export function Pill({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: IconName }) {
  return <span className={`am-pill ${tone}`}>{icon ? <Icon name={icon} size={11} /> : null}{children}</span>;
}

export function Avatar({ name, kind = "person", size }: { name: string; kind?: "person" | "guest" | "missing" | "group" | "workload"; size?: "lg" }) {
  const glyph = kind === "group" ? <Icon name="layers" size={13} /> : kind === "workload" ? <Icon name="cpu" size={13} /> : initials(name);
  return <span className={`am-avatar ${kind}${size ? ` ${size}` : ""}`} aria-hidden="true">{glyph}</span>;
}

export function Loading({ label }: { label: string }) {
  return <p className="am-empty" role="status">{label}</p>;
}
