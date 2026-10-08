import type { ReactNode } from "react";
import { useAccess } from "./AccessContext.js";

// Client-side visibility gate. The API is the real enforcement point
// (requireAccess in functions-restapi); this keeps people off a page their
// data calls would refuse, and says which access is missing in the same words
// the Roles page uses.
//
// Three answers, deliberately distinct: still asking, could not ask, and
// refused. The old gate only had the last one, so a slow or failed answer
// looked exactly like a revoked role.
export function RequireAccess({
  action,
  anyOf,
  children,
}: {
  action?: string;
  anyOf?: string[];
  children: ReactNode;
}) {
  const { loading, error, can, canAny, access, reload } = useAccess();
  const wanted = anyOf ?? (action ? [action] : []);

  if (loading) {
    return <div className="role-denied" aria-live="polite"><p>Checking your access…</p></div>;
  }

  if (error) {
    return (
      <div className="role-denied">
        <h1>Your access could not be read</h1>
        <p>{error}</p>
        <button type="button" onClick={reload}>Try again</button>
      </div>
    );
  }

  if (wanted.length > 0 && !(anyOf ? canAny(anyOf) : can(action!))) {
    const roles = access?.roles.map((role) => role.name) ?? [];
    return (
      <div className="role-denied">
        <h1>Restricted</h1>
        <p>
          {roles.length
            ? `This page is not part of your access. You hold: ${roles.join(", ")}.`
            : "You do not hold an OnBoard role yet."}
        </p>
        <p>Ask an Access Administrator if you need it.</p>
      </div>
    );
  }

  return <>{children}</>;
}

/** The landing page for somebody who is signed in and holds nothing. */
export function NoAccess() {
  const { access } = useAccess();
  return (
    <div className="role-denied">
      <h1>No access yet</h1>
      <p>
        {access?.person.name ? `${access.person.name}, your` : "Your"} sign-in works, but no OnBoard role has been
        granted to you.
      </p>
      <p>Ask an Access Administrator to grant you a role. They will see you listed once you have signed in.</p>
    </div>
  );
}
