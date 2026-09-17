// The one module that knows how to talk to Avail360.
//
// Six feed modules used to each carry their own copy of the same knowledge:
// read the URL and subscription key from settings, trim the base URL, format
// dates, append the endpoint's fixed path constants, send
// Ocp-Apim-Subscription-Key, check `success`, find the rows under the right
// result key, and fail loudly when the key has moved. None of them set a
// timeout, so a hung Avail call held the Function App's single worker. And
// /feed-checks rebuilt every URL a seventh time: it skipped the /MVTA trim the
// AVL poll applies and restated the OTP path constants, so the connection check
// did not test the request the polls actually send.
//
// A caller names an endpoint and the window it wants; this builds the request,
// authenticates, times out, unwraps the envelope and returns the rows. The feed
// modules keep what is genuinely theirs: the row shapes and how a row maps into
// OnBoard's tables.
//
// Every Avail lesson learned the hard way lives here, next to the request it
// protects:
// - AVL datetimes are agency-local (America/Chicago), not UTC (2026-08-07).
// - AVL colons stay literal; Avail silently returns nothing for %3A (2026-08-06).
// - AVL's base URL may or may not already end in /MVTA; Property is appended
//   exactly once (2026-08-06).
// - Result keys are lowercase (`otp`, `missed`, `detours`), not the operation
//   name; a response carrying other keys throws naming them rather than
//   syncing zero rows forever (2026-08-05, 2026-08-06).
//
// The dated endpoints other than AVL still format their dates from the UTC
// calendar, as they always have. That is a known question (an OTP Daily run at
// 03:30 UTC asks for a Central service day that has not finished), and it is
// now one function to change rather than three.
import type { AvailAvlReport } from "./availAvl";
import type { AvailDetourReport } from "./availDetoursFeed";
import type { AvailMissedTripReport } from "./availMissedTripsFeed";
import type { AvailPulloutReport } from "./availPullout";
import type { AvailOtpDailyReport } from "./otpDailyFeed";
import type { OtpMonthlyReport } from "./otpMonthlyFeed";

export type AvailEndpoint = "avl" | "pullout" | "otp_daily" | "otp_monthly" | "missed_trips" | "detours";

export interface AvailRequests {
  avl: { start: Date; end: Date };
  pullout: Record<string, never>;
  otp_daily: { start: Date; end: Date };
  // Avail aggregates to the whole month containing this date.
  otp_monthly: { month: Date };
  missed_trips: { start: Date; end: Date };
  detours: Record<string, never>;
}

export interface AvailRows {
  avl: AvailAvlReport;
  pullout: AvailPulloutReport;
  otp_daily: AvailOtpDailyReport;
  otp_monthly: OtpMonthlyReport;
  missed_trips: AvailMissedTripReport;
  detours: AvailDetourReport;
}

export interface AvailConfig {
  baseUrl: string;
  apiKey: string;
}

export interface AvailTransport {
  fetch?: typeof fetch;
  timeoutMs?: number;
  log?: (line: string) => void;
}

export const AVAIL_API_KEY_SETTING = "AVAIL_AVL_REPORTS_API_KEY";
const DEFAULT_TIMEOUT_MS = 30_000;
const AGENCY_TIME_ZONE = "America/Chicago";
const PROPERTY = "MVTA";

// OTP report parameters, shared by the daily and monthly operations.
const OTP_PARAMETERS = [
  1, // early threshold - enum-constrained per the API schema
  5, // late threshold - enum-constrained per the API schema
  15, // early outlier minutes - owner decision
  30, // late outlier minutes - owner decision
  0, // show missed stops
  1, // include outliers
  1, // show detours
].join("/");

// Missed Trips owner decisions: Full Trip Only=0 (either end missed counts, the
// broader reading) and Include Deadheads=0 (exclude non-revenue moves).
const MISSED_TRIP_PARAMETERS = [0, 0].join("/");

// Both OTP operations and Missed Trips take MM-DD-YYYY ("Pass any service date
// (MM-DD-YYYY)"), unlike AVL's datetime segments.
export function formatDateMmDdYyyy(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${m}-${d}-${y}`;
}

function agencyDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AGENCY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function trimmed(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

interface EndpointDefinition<E extends AvailEndpoint> {
  label: string;
  urlSetting: string;
  path: (baseUrl: string, request: AvailRequests[E]) => string;
  // The result key(s) the rows live under. `strict` makes a response carrying
  // other keys a thrown error naming them; without it a missing key is an
  // empty delivery.
  resultKeys: readonly string[];
  strict: boolean;
  // AVL logs its raw status and body so App Insights can tell "Avail sent
  // vehicles and we mis-parsed them" from "Avail sent an empty array".
  logRawResponse?: (request: AvailRequests[E]) => string;
}

const ENDPOINTS: { [E in AvailEndpoint]: EndpointDefinition<E> } = {
  avl: {
    label: "AVL",
    urlSetting: "AVAIL_AVL_REPORTS_URL",
    path: (baseUrl, { start, end }) => {
      const segment = (date: Date) => agencyDateTime(date).replace(/ /g, "%20");
      const base = trimmed(baseUrl).replace(new RegExp(`/${PROPERTY}$`, "i"), "");
      return `${base}/${PROPERTY}/${segment(start)}/${segment(end)}`;
    },
    resultKeys: ["AVL Reports"],
    strict: false,
    logRawResponse: ({ start, end }) => `window(${AGENCY_TIME_ZONE})=[${agencyDateTime(start)} -> ${agencyDateTime(end)}]`,
  },
  pullout: {
    label: "Pullout",
    urlSetting: "AVAIL_PULLOUT_URL",
    path: (baseUrl) => trimmed(baseUrl),
    resultKeys: ["Pullout"],
    strict: false,
  },
  otp_daily: {
    label: "OTP Daily",
    urlSetting: "AVAIL_OTP_DAILY_URL",
    path: (baseUrl, { start, end }) =>
      `${trimmed(baseUrl)}/${formatDateMmDdYyyy(start)}/${formatDateMmDdYyyy(end)}/${OTP_PARAMETERS}`,
    // `otp` is what Avail returns; the operation name is what its docs imply.
    resultKeys: ["otp", "OtpByRouteStopDayHour"],
    strict: true,
  },
  otp_monthly: {
    label: "OTP Monthly",
    urlSetting: "AVAIL_OTP_MONTHLY_URL",
    path: (baseUrl, { month }) => `${trimmed(baseUrl)}/${formatDateMmDdYyyy(month)}/${OTP_PARAMETERS}`,
    resultKeys: ["otp"],
    strict: true,
  },
  missed_trips: {
    label: "Missed Trips",
    urlSetting: "AVAIL_MISSED_TRIPS_URL",
    path: (baseUrl, { start, end }) =>
      `${trimmed(baseUrl)}/${formatDateMmDdYyyy(start)}/${formatDateMmDdYyyy(end)}/${MISSED_TRIP_PARAMETERS}`,
    resultKeys: ["missed"],
    strict: true,
  },
  detours: {
    label: "Detours",
    urlSetting: "AVAIL_DETOURS_URL",
    path: (baseUrl) => trimmed(baseUrl),
    resultKeys: ["detours"],
    strict: true,
  },
};

export function availLabel(endpoint: AvailEndpoint): string {
  return `Avail ${ENDPOINTS[endpoint].label}`;
}

// The endpoint's settings, or the names of the ones that are missing.
export function availConfig(
  endpoint: AvailEndpoint,
  env: NodeJS.ProcessEnv = process.env,
): { config: AvailConfig; missing?: never } | { config?: never; missing: string[] } {
  const urlSetting = ENDPOINTS[endpoint].urlSetting;
  const baseUrl = env[urlSetting]?.trim();
  const apiKey = env[AVAIL_API_KEY_SETTING]?.trim();
  if (baseUrl && apiKey) return { config: { baseUrl, apiKey } };
  return { missing: [...(baseUrl ? [] : [urlSetting]), ...(apiKey ? [] : [AVAIL_API_KEY_SETTING])] };
}

export function availUrl<E extends AvailEndpoint>(endpoint: E, baseUrl: string, request: AvailRequests[E]): string {
  return (ENDPOINTS[endpoint] as EndpointDefinition<E>).path(baseUrl, request);
}

export async function fetchAvail<E extends AvailEndpoint>(
  endpoint: E,
  request: AvailRequests[E],
  config: AvailConfig,
  transport: AvailTransport = {},
): Promise<AvailRows[E][]> {
  const definition = ENDPOINTS[endpoint] as EndpointDefinition<E>;
  const label = availLabel(endpoint);
  const url = definition.path(config.baseUrl, request);
  const response = await (transport.fetch ?? fetch)(url, {
    headers: { "Ocp-Apim-Subscription-Key": config.apiKey },
    signal: AbortSignal.timeout(transport.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  let body = "";
  try {
    body = await response.text();
  } catch {
    /* body not readable - status code is all we get */
  }
  if (definition.logRawResponse) {
    (transport.log ?? console.log)(
      `${label} raw response: status=${response.status} url=${url} ${definition.logRawResponse(request)} ` +
        `bodyLength=${body.length} body=${body.slice(0, 2000)}`,
    );
  }
  if (!response.ok) {
    throw new Error(`${label} request failed: ${response.status} - ${body.slice(0, 500)}`);
  }

  let payload: { success?: boolean; errors?: string[]; result?: Record<string, unknown> };
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`${label} returned unparseable JSON (status ${response.status}): ${body.slice(0, 500)}`);
  }
  if (!payload.success) {
    throw new Error(`${label} API returned success=false: ${payload.errors?.join(", ") || "no error detail"}`);
  }

  for (const key of definition.resultKeys) {
    const rows = payload.result?.[key];
    if (Array.isArray(rows)) return rows as AvailRows[E][];
  }
  // The expected key wasn't found. If result carries any other key, that is
  // almost certainly where the rows moved to: name the keys (never the data)
  // rather than syncing zero rows forever. The `results` metadata sibling does
  // not count on its own.
  const actualKeys = payload.result ? Object.keys(payload.result) : [];
  if (definition.strict && actualKeys.some((key) => key !== "results")) {
    throw new Error(
      `${label} response has no "${definition.resultKeys[0]}" key under result - found [${actualKeys.join(", ")}] instead.`,
    );
  }
  return [];
}

export interface AvailProbe {
  name: string;
  configured: boolean;
  status?: number;
  records?: number;
  keys?: string[];
  error?: string;
}

// The /feed-checks connection test: the same settings, URL, auth, timeout and
// envelope handling the poll uses, so a passing check means the poll's own
// request works.
export async function probeAvail<E extends AvailEndpoint>(
  endpoint: E,
  request: AvailRequests[E],
  transport: AvailTransport = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<AvailProbe> {
  const name = availLabel(endpoint);
  const settings = availConfig(endpoint, env);
  if (!settings.config) {
    const keyOnly = settings.missing.length === 1 && settings.missing[0] === AVAIL_API_KEY_SETTING;
    return keyOnly ? { name, configured: false, error: "Subscription key unavailable" } : { name, configured: false };
  }
  try {
    const rows = await fetchAvail(endpoint, request, settings.config, { ...transport, log: transport.log ?? (() => {}) });
    const first = rows[0];
    return {
      name,
      configured: true,
      status: 200,
      records: rows.length,
      keys: first && typeof first === "object" ? Object.keys(first) : undefined,
    };
  } catch (error) {
    return { name, configured: true, error: error instanceof Error ? error.message : "Request failed" };
  }
}
