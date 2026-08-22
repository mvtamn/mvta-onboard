import { useState } from "react";
import { NavLink } from "react-router-dom";
import { roleLabel, type AppRole } from "../auth/roles.js";

const ROLE_PRIORITY: AppRole[] = [
  "OCC.Admin",
  "OCC.AccessAdmin",
  "OCC.Publisher",
  "OCC.ComplianceManager",
  "OCC.Compliance",
  "OCC.Detour",
  "OCC.EventAVL",
  "OCC.Viewer",
  "System.Ingestion",
];

type OperatorIdentityProps = {
  name: string;
  username: string;
  roles: AppRole[];
  canManageAccess: boolean;
  onSignOut: () => void;
};

export function OperatorIdentity({ name, username, roles, canManageAccess, onSignOut }: OperatorIdentityProps) {
  const [open, setOpen] = useState(false);
  const [primaryRole] = ROLE_PRIORITY.filter((role) => roles.includes(role));
  const extraRoleCount = Math.max(0, roles.length - (primaryRole ? 1 : 0));
  const summary = primaryRole
    ? `${name} · ${roleLabel(primaryRole)}${extraRoleCount ? ` +${extraRoleCount}` : ""}`
    : `${name} · ${roles.length ? `${roles.length} roles` : "No assigned access"}`;

  return (
    <div className="operator-identity">
      <button
        className="pill-user"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="operator-identity-menu"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar">{initialsOf(name)}</span>
        <span className="operator-identity-summary">{summary}</span>
        <span className="operator-identity-chevron" aria-hidden="true">⌄</span>
      </button>
      {open ? <section className="operator-identity-menu" id="operator-identity-menu" role="dialog" aria-label="Account details">
        <strong>{name}</strong>
        <span className="operator-identity-username">{username}</span>
        <span className="operator-identity-label">Assigned roles</span>
        {roles.length ? <ul>{roles.map((role) => <li key={role}>{roleLabel(role)}</li>)}</ul> : <span>No assigned access</span>}
        <div className="operator-identity-actions">
          {canManageAccess ? <NavLink to="/admin/access">View access</NavLink> : null}
          <button className="btn-signout" type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </section> : null}
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
