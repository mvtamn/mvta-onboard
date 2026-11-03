// Ridership counting (ADR 0043, plans/ridership-build-plan.md PR 2). Every
// rule is in lib/ridership; these handlers check access, read the route and
// query, and translate the module's results into HTTP.
//
//   GET /ridership/worklist?from=&to=         - ridership.view
//     Sheets with their state and garage, late first, and completeness by
//     garage. Service dates as YYYYMMDD; the default is the last eight days.
//   GET /ridership/sheets/{date}/{block}       - ridership.view
//     The block's trips and which need a count, Avail's pull-out pre-fill,
//     what has been saved, and the sheet's history.
//   PUT /ridership/sheets/{date}/{block}       - ridership.enter
//     The whole sheet. Every trip that needs a count must have a number, Not
//     counted or Did not operate. 409 when someone saved it since `version`.
//   GET /ridership/block-garages               - ridership.view
//   PUT /ridership/block-garages               - ridership.configure
//     One service change's block -> garage rows, from `effective_from`.
//   GET /ridership/print?date=&garage=         - ridership.print
//     The date's sheets in pull-out order with where each stands against the
//     print log (not printed, printed, changed since). The default date is
//     tomorrow. `garage=` (empty) is the Unassigned blocks; no `garage` is all.
//   POST /ridership/print                      - ridership.print
//     { date, garage, blocks?, blank_backs?, link_base } -> one PDF of the
//     garage's sheets (or just `blocks`, a reprint), logged as it is made.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { requireAccess } from "../lib/access/require";
import { agencyServiceDate } from "../lib/missedTripTime";
import {
  addDays,
  buildWorklist,
  daysBetween,
  isServiceDate,
  linkBaseFor,
  listBlockGarages,
  loadPrintStatus,
  loadSheet,
  normalizeBlock,
  printCountSheets,
  printLogReady,
  ridershipTablesReady,
  type PrintRequest,
  saveBlockGarages,
  saveSheet,
} from "../lib/ridership";

const NOT_READY = {
  status: 503,
  jsonBody: { error: "Ridership counting is not set up in this environment yet. Apply migration 153." },
};

const PRINT_NOT_READY = {
  status: 503,
  jsonBody: { error: "Count Sheet printing is not set up in this environment yet. Apply migration 157." },
};

/** A garage's whole stack is about 70 blocks; a reprint names a few of them. */
const MAX_REPRINT_BLOCKS = 200;

/** A month and a bit: enough for a month's completeness, small enough to stay quick. */
const MAX_WORKLIST_DAYS = 62;

const actorOf = (principal: { userDetails?: string | null }) => principal.userDetails || "system";

/** The blocks the setup page lists: what ran in the last two weeks, and tomorrow's. */
function recentRange(now: Date) {
  const today = agencyServiceDate(now).serviceDate;
  return { from: addDays(today, -14), to: addDays(today, 1) };
}

async function readJson(request: HttpRequest): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

function sheetAddress(request: HttpRequest): { serviceDate: string; block: string } | { error: string } {
  const serviceDate = request.params.date ?? "";
  const block = normalizeBlock(request.params.block ?? "");
  if (!isServiceDate(serviceDate)) return { error: "date must be a calendar day as YYYYMMDD." };
  if (!block) return { error: "block must be a block number of up to three digits." };
  return { serviceDate, block };
}

app.http("ridershipWorklist", {
  route: "ridership/worklist",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "ridership.view");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };

    const now = new Date();
    const today = agencyServiceDate(now).serviceDate;
    const to = request.query.get("to")?.trim() || today;
    const from = request.query.get("from")?.trim() || addDays(to, -7);
    if (!isServiceDate(from) || !isServiceDate(to)) {
      return { status: 400, jsonBody: { error: "from and to must be calendar days as YYYYMMDD." } };
    }
    const days = daysBetween(from, to);
    if (days < 1 || days > MAX_WORKLIST_DAYS) {
      return { status: 400, jsonBody: { error: `from must be on or before to, at most ${MAX_WORKLIST_DAYS} days apart.` } };
    }

    try {
      const pool = await getPool();
      if (!(await ridershipTablesReady(pool))) return NOT_READY;
      return { status: 200, jsonBody: await buildWorklist(pool, from, to, now) };
    } catch (err) {
      context.error("GET /ridership/worklist failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("ridershipSheetGet", {
  route: "ridership/sheets/{date}/{block}",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "ridership.view");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const address = sheetAddress(request);
    if ("error" in address) return { status: 400, jsonBody: { error: address.error } };

    try {
      const pool = await getPool();
      if (!(await ridershipTablesReady(pool))) return NOT_READY;
      const sheet = await loadSheet(pool, address.serviceDate, address.block);
      if (!sheet) {
        return { status: 404, jsonBody: { error: `Block ${address.block} has no trips in the Dispatch Log on ${address.serviceDate}.` } };
      }
      return { status: 200, jsonBody: sheet };
    } catch (err) {
      context.error("GET /ridership/sheets failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("ridershipSheetPut", {
  route: "ridership/sheets/{date}/{block}",
  methods: ["PUT"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "ridership.enter");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const address = sheetAddress(request);
    if ("error" in address) return { status: 400, jsonBody: { error: address.error } };

    const now = new Date();
    // A sheet is keyed once its day has run. Today's is allowed for a block
    // that has already pulled in; tomorrow's has nothing to count yet.
    if (address.serviceDate > agencyServiceDate(now).serviceDate) {
      return { status: 400, jsonBody: { error: "That service date has not happened yet." } };
    }
    const body = await readJson(request);
    if (!body.ok) return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };

    try {
      const pool = await getPool();
      if (!(await ridershipTablesReady(pool))) return NOT_READY;
      const result = await saveSheet(pool, address.serviceDate, address.block, body.body, actorOf(auth.principal), now);
      switch (result.kind) {
        case "invalid":
          return { status: 400, jsonBody: { error: "Validation failed", details: result.problems } };
        case "not_found":
          return { status: 404, jsonBody: { error: `Block ${address.block} has no trips in the Dispatch Log on ${address.serviceDate}.` } };
        case "conflict":
          return {
            status: 409,
            jsonBody: { error: "Someone else saved this sheet after you opened it. Reload it to see their changes.", version: result.version },
          };
        case "saved":
          return { status: 200, jsonBody: { ...result.sheet, changes: result.changes } };
      }
    } catch (err) {
      context.error("PUT /ridership/sheets failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("ridershipBlockGaragesGet", {
  route: "ridership/block-garages",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "ridership.view");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    try {
      const pool = await getPool();
      if (!(await ridershipTablesReady(pool))) return NOT_READY;
      return { status: 200, jsonBody: await listBlockGarages(pool, recentRange(new Date())) };
    } catch (err) {
      context.error("GET /ridership/block-garages failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("ridershipBlockGaragesPut", {
  route: "ridership/block-garages",
  methods: ["PUT"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "ridership.configure");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const body = await readJson(request);
    if (!body.ok) return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    try {
      const pool = await getPool();
      if (!(await ridershipTablesReady(pool))) return NOT_READY;
      const now = new Date();
      const result = await saveBlockGarages(pool, body.body, actorOf(auth.principal), recentRange(now), now);
      if (result.kind === "invalid") return { status: 400, jsonBody: { error: "Validation failed", details: result.problems } };
      return { status: 200, jsonBody: result.list };
    } catch (err) {
      context.error("PUT /ridership/block-garages failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

/** `garage` absent is every garage; present and empty is the Unassigned blocks. */
function garageQuery(request: HttpRequest): string | null | undefined {
  const raw = request.query.get("garage");
  if (raw === null) return undefined;
  return raw.trim() === "" ? null : raw.trim();
}

app.http("ridershipPrintStatus", {
  route: "ridership/print",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "ridership.print");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const serviceDate = request.query.get("date")?.trim() || agencyServiceDate(new Date(), 1).serviceDate;
    if (!isServiceDate(serviceDate)) return { status: 400, jsonBody: { error: "date must be a calendar day as YYYYMMDD." } };

    try {
      const pool = await getPool();
      if (!(await ridershipTablesReady(pool))) return NOT_READY;
      if (!(await printLogReady(pool))) return PRINT_NOT_READY;
      return { status: 200, jsonBody: await loadPrintStatus(pool, serviceDate, garageQuery(request)) };
    } catch (err) {
      context.error("GET /ridership/print failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

/** The body as the module takes it; the link base must come from the console the request came from. */
function parsePrintBody(raw: unknown, requestOrigin: string | null): { input: PrintRequest } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Request body must be an object." };
  const b = raw as Record<string, unknown>;
  const date = typeof b.date === "string" ? b.date.trim() : "";
  if (!isServiceDate(date)) return { error: "date must be a calendar day as YYYYMMDD." };
  if (b.garage !== null && typeof b.garage !== "string") return { error: "garage must be a garage name, or null for the Unassigned blocks." };
  const garage = typeof b.garage === "string" && b.garage.trim() !== "" ? b.garage.trim() : null;
  let blocks: string[] | undefined;
  if (b.blocks !== undefined) {
    if (!Array.isArray(b.blocks) || b.blocks.length === 0 || b.blocks.length > MAX_REPRINT_BLOCKS) {
      return { error: `blocks must list between 1 and ${MAX_REPRINT_BLOCKS} block numbers.` };
    }
    blocks = [];
    for (const value of b.blocks) {
      const block = typeof value === "string" ? normalizeBlock(value) : null;
      if (!block) return { error: "blocks must be block numbers of up to three digits." };
      if (!blocks.includes(block)) blocks.push(block);
    }
  }
  if (b.blank_backs !== undefined && typeof b.blank_backs !== "boolean") return { error: "blank_backs must be true or false." };
  const linkBase = linkBaseFor(b.link_base, requestOrigin);
  if (!linkBase) return { error: "link_base must be the https address of the console you are printing from." };
  return { input: { service_date: date, garage, blocks, blank_backs: b.blank_backs === true, link_base: linkBase } };
}

app.http("ridershipPrint", {
  route: "ridership/print",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireAccess below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const auth = await requireAccess(request, "ridership.print");
    if (!auth.authorized) return { status: auth.status, jsonBody: { error: auth.message } };
    const json = await readJson(request);
    if (!json.ok) return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    const parsed = parsePrintBody(json.body, request.headers.get("origin"));
    if ("error" in parsed) return { status: 400, jsonBody: { error: parsed.error } };

    try {
      const pool = await getPool();
      if (!(await ridershipTablesReady(pool))) return NOT_READY;
      if (!(await printLogReady(pool))) return PRINT_NOT_READY;
      const result = await printCountSheets(pool, parsed.input, actorOf(auth.principal));
      if (result.kind === "nothing") return { status: 404, jsonBody: { error: result.message } };
      return {
        status: 200,
        body: result.pdf,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${result.filename}"`,
          "X-Count-Sheets": String(result.sheets),
          "X-Count-Sheet-Pages": String(result.pages),
        },
      };
    } catch (err) {
      context.error("POST /ridership/print failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
