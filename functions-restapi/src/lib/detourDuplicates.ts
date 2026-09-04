// Likely-duplicate detection for Detour Intake (detour-functionality-spec
// item 11): an intake whose route or location scope AND operating window
// overlap an existing record enough to require human review. Detection
// warns the reviewer; it never merges or rejects on its own.
//
// Pure and in-memory. GET /detour-intake already loads every intake, and
// the Detours table is small enough to load whole (there is no pagination
// anywhere in the module), so the comparison runs once per list call
// rather than as a query per row.
import { dateWindowsOverlap, type DateWindow } from "./detourWorkflow";
import { geometryDistance, type DetourGeometry } from "./geoNearby";

export interface DuplicateScope extends DateWindow {
  id: string;
  // Free text describing where the closure is: intake location +
  // description, or Detour closure + location.
  place_text: string;
  // Route/stop strings from segments, and the mobility service area.
  route_texts: string[];
  // Drawn shape when the record has one (migration 091). Two shapes within
  // GEOMETRY_MATCH_M of each other are the strongest signal there is.
  geometry?: DetourGeometry | null;
}

// Two closures drawn within this distance are treated as the same place.
export const GEOMETRY_MATCH_M = 75;

export interface DuplicateCandidate extends DuplicateScope {
  kind: "detour" | "intake";
  label: string;
  status: string;
}

export type DuplicateReason = "geometry" | "routes" | "location";

export interface LikelyDuplicate {
  kind: "detour" | "intake";
  id: string;
  label: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  reasons: DuplicateReason[];
  // Route tokens or location words the two records share - shown so the
  // reviewer can see WHY, not just that.
  shared: string[];
}

// "460 SB, 465 SB" -> {"460","465"}; "Route 21" -> {"21"}; "Stop 12345"
// -> {"12345"}. Route identity is the number; direction suffixes and
// labels only add noise.
export function routeTokens(texts: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/\b([A-Za-z]{0,2}\d{1,5}[A-Za-z]?)\b/g)) tokens.add(match[1].toUpperCase());
  }
  return tokens;
}

const PLACE_STOPWORDS = new Set([
  "the", "and", "or", "of", "at", "to", "on", "in", "by", "for", "from", "with", "near", "between",
  "closed", "closure", "closing", "detour", "detoured", "road", "rd", "street", "st", "ave", "avenue", "blvd", "boulevard",
  "dr", "drive", "ln", "lane", "hwy", "highway", "ct", "court", "pkwy", "parkway", "way", "trail", "tr",
  "north", "south", "east", "west", "n", "s", "e", "w", "nb", "sb", "eb", "wb", "bound",
  "stop", "stops", "station", "bus", "route", "routes", "service", "construction", "work", "project",
  "will", "be", "is", "are", "until", "through", "thru", "due", "a", "an",
]);

// Meaningful place words: street/landmark names, numbered streets ("5th"),
// facility names. Generic road-type and direction words are dropped so
// "Cedar Ave closed" and "Cedar Avenue construction" still share "cedar"
// but "Main St closed" and "Oak St closed" share nothing.
export function placeTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || PLACE_STOPWORDS.has(raw)) continue;
    if (/^\d+$/.test(raw) && raw.length > 4) continue; // years, case numbers
    tokens.add(raw);
  }
  return tokens;
}

function intersect<T>(a: Set<T>, b: Set<T>): T[] {
  return [...a].filter((item) => b.has(item));
}

export function findLikelyDuplicates(subject: DuplicateScope, candidates: DuplicateCandidate[]): LikelyDuplicate[] {
  const subjectRoutes = routeTokens(subject.route_texts);
  const subjectPlace = placeTokens(subject.place_text);
  const found: LikelyDuplicate[] = [];
  for (const candidate of candidates) {
    if (candidate.id === subject.id) continue;
    if (!dateWindowsOverlap(subject, candidate)) continue;
    const reasons: DuplicateReason[] = [];
    const shared: string[] = [];
    if (subject.geometry && candidate.geometry) {
      const metres = geometryDistance(subject.geometry, candidate.geometry);
      if (metres <= GEOMETRY_MATCH_M) { reasons.push("geometry"); shared.push(metres < 1 ? "same place on the map" : `${Math.round(metres)} m apart on the map`); }
    }
    const routes = intersect(subjectRoutes, routeTokens(candidate.route_texts));
    if (routes.length > 0) { reasons.push("routes"); shared.push(...routes); }
    const place = intersect(subjectPlace, placeTokens(candidate.place_text));
    // One shared street name is a strong signal on its own ("cedar");
    // require two when the overlap is only generic-ish words to keep
    // "5th" from matching every 5th-street closure in the county.
    if (place.length >= 2 || (place.length === 1 && !/^\d+(st|nd|rd|th)$/.test(place[0]))) { reasons.push("location"); shared.push(...place); }
    if (reasons.length === 0) continue;
    found.push({
      kind: candidate.kind, id: candidate.id, label: candidate.label, status: candidate.status,
      start_date: candidate.start_date, end_date: candidate.end_date, reasons, shared,
    });
  }
  // Map matches first, then route matches, then by most evidence.
  const rank = (m: LikelyDuplicate) => (m.reasons.includes("geometry") ? 2 : 0) + (m.reasons.includes("routes") ? 1 : 0);
  return found.sort((a, b) => rank(b) - rank(a) || b.shared.length - a.shared.length);
}
