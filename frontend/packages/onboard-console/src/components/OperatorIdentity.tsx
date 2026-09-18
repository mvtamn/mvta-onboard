import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useAccess } from "../auth/AccessContext.js";

type OperatorIdentityProps = {
  name: string;
  username: string;
  canManageAccess: boolean;
  onSignOut: () => void;
};

export function OperatorIdentity({ name, username, canManageAccess, onSignOut }: OperatorIdentityProps) {
  const { access } = useAccess();
  // The roles the server holds, in the order it returns them.
  const roles = access?.roles ?? [];
  const [open, setOpen] = useState(false);
  const [primaryRole] = roles;
  const extraRoleCount = Math.max(0, roles.length - (primaryRole ? 1 : 0));
  const summary = primaryRole
    ? `${name} · ${primaryRole.name}${extraRoleCount ? ` +${extraRoleCount}` : ""}`
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
        {roles.length ? <ul>{roles.map((role) => <li key={role.key}>{role.name}</li>)}</ul> : <span>No assigned access</span>}
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
