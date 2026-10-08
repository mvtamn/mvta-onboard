/**
 * Event AVL staff need to read the Event and operating-period lists in order
 * to choose an operational context, which is the Event AVL module's own view
 * action; changing either resource is editing the plan behind it.
 */
export function eventOperatingContextAction(method: string): string {
  return method === "GET" ? "event-avl.view" : "event-planning.edit";
}
