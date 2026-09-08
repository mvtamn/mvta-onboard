import { resolveOtpFixedRoute } from "./otpFixedRoute";
import type { RegisteredResolver, ResolvedMeasurement, ResolverContext } from "./types";
import { notMeasurable } from "./types";

export type { RegisteredResolver, ResolvedMeasurement, ResolverContext, ThresholdResolver } from "./types";
export { notMeasurable } from "./types";
export { resolveManualMetric } from "./manualMetric";

// What `ContractorPerformanceStandards.resolver_key` names.
//
// The column has existed since migration 030 and, until now, was referenced by
// no code at all: assess.ts branched on `standard.code === "OTP_FIXED_ROUTE"`.
// The catalog therefore advertised a resolver registry that did not exist, and
// adding an automated standard meant editing the compute rather than adding a
// row - the opposite of what the design promised.
//
// Two kinds of entry live here, because resolver_key means two things
// depending on the standard it sits on, and pretending otherwise would put a
// measurement function on a row that has no value to measure:
//
//   threshold  - a function that measures one number for the month. This is a
//                resolver in the ordinary sense.
//   occurrence - the intake that raises ComplianceOccurrences for the standard
//                (complianceCandidatesPoll, or a reviewer confirming one).
//                There is nothing to call at compute time: the occurrences are
//                already rows, and assess.ts aggregates them. The entry exists
//                so the key is a checkable value rather than free text, and so
//                the console can say what feeds the standard.
export const RESOLVERS: RegisteredResolver[] = [
  {
    key: "OTP_FIXED_ROUTE",
    label: "Avail monthly on-time performance",
    description: "Fixed-route departures from Avail's monthly OTP feed, excluding special-event routes and approved stop exclusions.",
    appliesTo: "threshold",
    source: "api_feed",
    resolve: resolveOtpFixedRoute,
  },
  {
    key: "MISSED_TRIPS_FR",
    label: "Confirmed missed trips",
    description: "Occurrences raised from MonitoredMissedTrips once a reviewer confirms the trip, from both the GTFS and Spare pipelines.",
    appliesTo: "occurrence",
    source: "onboard_compliance",
  },
  {
    key: "GARAGE_DEPARTURE",
    label: "Late and missed garage departures",
    description: "Occurrences raised from Avail pullouts and Spare duties that departed past the variance allowance or not at all.",
    appliesTo: "occurrence",
    source: "onboard_compliance",
  },
];

const BY_KEY = new Map(RESOLVERS.map((resolver) => [resolver.key, resolver]));

export function findResolver(key: string | null | undefined): RegisteredResolver | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

export function resolverKeys(): string[] {
  return RESOLVERS.map((resolver) => resolver.key);
}

export function resolversForSource(source: string): RegisteredResolver[] {
  return RESOLVERS.filter((resolver) => resolver.source === source);
}

// Measure one automated threshold standard.
//
// An unknown or absent key does not fall through to manual entry. That was the
// old behaviour and it was the worst possible one: the compute found no
// hand-entered figure either, scored the month "no data", and a scorecard
// reading "no data" looks like a quiet month rather than a standard nobody can
// measure. It now comes back not-measurable with the misconfiguration named,
// which assess.ts records as not_assessable - flagged, making the period
// partial, and requiring an authorized exception before it can be finalized.
export async function resolveAutomatedThreshold(
  key: string | null | undefined,
  context: ResolverContext,
): Promise<ResolvedMeasurement> {
  const resolver = findResolver(key);
  if (!resolver) {
    return notMeasurable(key
      ? `${context.standardCode} is set to measure automatically with resolver "${key}", which is not registered. Correct it under Administration > Performance Standards.`
      : `${context.standardCode} is set to measure automatically but names no resolver. Set one under Administration > Performance Standards.`);
  }
  if (!resolver.resolve) {
    return notMeasurable(`${context.standardCode} names the ${resolver.label} intake, which raises occurrences rather than measuring a monthly value. A threshold standard needs a measuring resolver.`);
  }
  return resolver.resolve(context);
}
