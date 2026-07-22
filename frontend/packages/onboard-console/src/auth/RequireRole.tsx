import type { ReactNode } from "react";
import { useAuth } from "./AuthContext.js";
import type { AppRole } from "./roles.js";

// Client-side visibility gate. The API is the real enforcement point
// (functions-restapi requireRole); this just avoids showing staff a module
// they can't use.
export function RequireRole({ allowed, children }: { allowed: AppRole[]; children: ReactNode }) {
  const { roles } = useAuth();

  if (!roles.some((r) => allowed.includes(r))) {
    return (
      <div className="role-denied">
        <h1>Restricted</h1>
        <p>This module requires the {allowed.join(" or ")} role. Ask an administrator for access.</p>
      </div>
    );
  }
  return <>{children}</>;
}
