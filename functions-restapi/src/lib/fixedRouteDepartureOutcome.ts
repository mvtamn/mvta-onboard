// How one fixed-route garage departure is judged.
//
// The rule itself now lives in lib/garageDeparture, declared once as an
// ordered ladder that both this judgement and the candidate poll's WHERE
// clause are derived from. This file stays so its callers - GET
// /fixed-route-departures and the console's row summary - keep importing the
// name they always have.
export {
  DEPARTURE_OUTCOME_STATUSES,
  type FixedRouteDepartureJudgement,
  type FixedRouteDepartureOutcome,
  fixedRouteDepartureOutcome,
} from "./garageDeparture";
