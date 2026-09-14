// The data-state vocabulary shared by the console's live indicators, kept free
// of any fetching so that pure mappings (feedFreshness.ts) can use it without
// importing - or, in a test, being broken by a mock of - the hooks that fetch.
export type OperationalDataState = "loading" | "live" | "stale" | "unavailable" | "authentication-required";

// The worst of several states: what is broken outranks what is behind, which
// outranks what is still loading, which outranks what is fine.
export function worstDataState(states: OperationalDataState[]): OperationalDataState {
  const priority: OperationalDataState[] = ["authentication-required", "unavailable", "stale", "loading", "live"];
  return priority.find((state) => states.includes(state)) ?? "loading";
}
