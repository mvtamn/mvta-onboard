import { ADMIN_ROLES, STAFF_READ_ROLES } from "./auth";

/**
 * Event AVL staff need to read the Event and operating-period lists in order
 * to choose an operational context; changing either resource remains an
 * administrative action.
 */
export function eventOperatingContextRoles(method: string): string[] {
  return method === "GET" ? STAFF_READ_ROLES : ADMIN_ROLES;
}
