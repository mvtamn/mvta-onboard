// GET /feed-checks - staff-only, PII-free upstream feed diagnostics.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { requireRole, STAFF_READ_ROLES } from "../lib/auth";
import { summarizeFeedResponse } from "../lib/feedCheckResponse";

type FeedCheck = {
  name: string;
  configured: boolean;
  status?: number;
  records?: number;
  keys?: string[];
  error?: string;
};

function dateMmDdYyyy(date: Date): string {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}-${date.getUTCFullYear()}`;
}

function chicagoDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}%20${value("hour")}:${value("minute")}:${value("second")}`;
}

async function checkJson(name: string, url: string, auth?: Record<string, string>): Promise<FeedCheck> {
  try {
    const response = await fetch(url, {
      headers: auth,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { name, configured: true, status: response.status };
    const summary = summarizeFeedResponse(await response.json());
    return { name, configured: true, status: response.status, ...summary };
  } catch (error) {
    return { name, configured: true, error: error instanceof Error ? error.message : "Request failed" };
  }
}

async function checkStaticGtfs(url: string | undefined): Promise<FeedCheck> {
  if (!url?.trim()) return { name: "GTFS static", configured: false };
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return { name: "GTFS static", configured: true, status: response.status, records: Number(response.headers.get("content-length") ?? 0) };
  } catch (error) {
    return { name: "GTFS static", configured: true, error: error instanceof Error ? error.message : "Request failed" };
  }
}

app.http("feedChecks", {
  route: "feed-checks",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request: HttpRequest, _context: InvocationContext) => {
    const auth = requireRole(request, STAFF_READ_ROLES);
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const weekAgo = new Date(now);
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
    const key = process.env.AVAIL_AVL_REPORTS_API_KEY?.trim();
    const configured = (name: string, url: string | undefined) => url?.trim()
      ? key ? checkJson(name, url.trim(), { "Ocp-Apim-Subscription-Key": key }) : Promise.resolve({ name, configured: false, error: "Subscription key unavailable" } satisfies FeedCheck)
      : Promise.resolve({ name, configured: false } satisfies FeedCheck);
    const avlStart = new Date(now.getTime() - 10 * 60_000);
    const spareKey = process.env.SPARE_API_KEY?.trim();
    const nowSeconds = Math.floor(now.getTime() / 1000);

    const checks = await Promise.all([
      checkJson("GTFS TripUpdates", process.env.GTFS_RT_TRIPUPDATE_URL?.trim() ?? ""),
      checkJson("GTFS VehiclePositions", process.env.GTFS_RT_VEHICLE_URL?.trim() ?? ""),
      checkJson("GTFS Alerts", process.env.GTFS_RT_ALERT_URL?.trim() ?? ""),
      checkStaticGtfs(process.env.GTFS_STATIC_URL),
      configured("Avail AVL", process.env.AVAIL_AVL_REPORTS_URL?.trim()
        ? `${process.env.AVAIL_AVL_REPORTS_URL!.trim().replace(/\/+$/, "")}/MVTA/${chicagoDateTime(avlStart)}/${chicagoDateTime(now)}`
        : undefined),
      configured("Avail Pullout", process.env.AVAIL_PULLOUT_URL),
      configured("Avail OTP Monthly", process.env.AVAIL_OTP_MONTHLY_URL?.trim()
        ? `${process.env.AVAIL_OTP_MONTHLY_URL!.trim()}/${dateMmDdYyyy(now)}/1/5/15/30/0/1/1`
        : undefined),
      configured("Avail OTP Daily", process.env.AVAIL_OTP_DAILY_URL?.trim()
        ? `${process.env.AVAIL_OTP_DAILY_URL!.trim()}/${dateMmDdYyyy(yesterday)}/${dateMmDdYyyy(yesterday)}/1/5/15/30/0/1/1`
        : undefined),
      configured("Avail Missed Trips", process.env.AVAIL_MISSED_TRIPS_URL?.trim()
        ? `${process.env.AVAIL_MISSED_TRIPS_URL!.trim()}/${dateMmDdYyyy(weekAgo)}/${dateMmDdYyyy(now)}/0/0`
        : undefined),
      spareKey
        ? checkJson("Spare Requests", `https://api.us.sparelabs.com/v1/requests?fromUpdatedAt=${nowSeconds - 7200}&toUpdatedAt=${nowSeconds}&limit=1&skip=0`, { Authorization: `Bearer ${spareKey}` })
        : Promise.resolve({ name: "Spare Requests", configured: false, error: "API key unavailable" } satisfies FeedCheck),
    ]);
    return { status: 200, jsonBody: { checked_at: now.toISOString(), checks } };
  },
});
