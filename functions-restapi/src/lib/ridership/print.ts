// Count Sheet printing (plans/ridership-build-plan.md PR 4, spec §3, the
// bulk-printing evaluation of 2026-10-31). A garage's check-in desk prints the
// next service date's sheets as one PDF:
//   * one garage at a time, in pull-out order (each block's first trip), so
//     the stack comes off the printer in the order sheets are handed out;
//   * one block per page, continued on a second page past 14 trips;
//   * optionally a blank back per page, so a printer that defaults to
//     double-sided never puts two blocks on one piece of paper;
//   * logged: who printed which garage and date, and when, with a fingerprint
//     of each block's trips so a block the Dispatch Log changed since is
//     flagged and can be reprinted on its own.
// Any service date prints, not only tomorrow's, so a lost sheet can be
// reprinted; the copy carries the same code because the code names the
// sheet, not the copy.
import { createHash } from "node:crypto";
import { sql } from "../db";
import type { Executor } from "../otpMonth";
import { renderCountSheets } from "./countSheetPdf";
import { garageOn } from "./rules";
import { loadBlockGarages, loadLoggedTrips, loadPrintLog, writePrintRun, type StoredPrintRun, type StoredPrintedSheet } from "./store";
import type { LoggedTrip, PrintScope } from "./types";

/** Spec §3: a block with more trips continues on page 2. */
export const TRIPS_PER_PAGE = 14;

export interface PrintTrip {
  trip_id: string;
  route_short_name: string | null;
  /** What the sheet prints in the Route column. */
  route_label: string | null;
  /** What the sheet prints in the Trip column: "320-E", as Avail and dispatch name the trip. */
  trip_number: string | null;
  direction_label: string | null;
  scheduled_start_seconds: number;
  scheduled_end_seconds: number | null;
}

export interface PrintSheet {
  block: string;
  garage: string | null;
  first_start_seconds: number;
  trips: PrintTrip[];
  pages: number;
  fingerprint: string;
  /** Place in the garage's stack, 1-based, counted over the whole garage even on a reprint. */
  order: number;
}

/**
 * Which garages to print. `undefined` is every garage; `null` is the
 * Unassigned blocks, which print like any garage so none goes missing.
 */
export type GarageChoice = string | null | undefined;

/** The items for the chosen garage; every item when every garage is chosen. */
export function inGarage<T extends { garage: string | null }>(items: readonly T[], garage: GarageChoice): T[] {
  return garage === undefined ? [...items] : items.filter((item) => item.garage === garage);
}

export const pageCount = (trips: number) => Math.max(1, Math.ceil(trips / TRIPS_PER_PAGE));

/** What is printed on the sheet, hashed: a change to any of it means the printed copy is stale. */
export function sheetFingerprint(trips: readonly PrintTrip[]): string {
  const printed = trips.map((t) => [t.trip_id, t.route_label ?? "", t.direction_label ?? "", t.scheduled_start_seconds, t.scheduled_end_seconds ?? ""].join("|"));
  return createHash("sha256").update(printed.join("\n")).digest("hex");
}

/**
 * The service date's sheets for a garage, in pull-out order: first trip time,
 * then block number. Every Dispatch Log trip on the block prints, including
 * any already known to be missed or canceled; OCC excuses those on entry.
 */
export function sheetsToPrint(
  trips: readonly LoggedTrip[],
  garages: readonly { block: string; effective_from: string; garage: string | null }[],
  serviceDate: string,
  garage: GarageChoice,
): PrintSheet[] {
  const byBlock = new Map<string, PrintTrip[]>();
  for (const trip of trips) {
    if (trip.service_date !== serviceDate || !trip.block) continue;
    const list = byBlock.get(trip.block) ?? [];
    list.push({
      trip_id: trip.trip_id,
      route_short_name: trip.route_short_name,
      route_label: trip.route_label,
      trip_number: trip.trip_number,
      direction_label: trip.direction_label,
      scheduled_start_seconds: trip.scheduled_start_seconds,
      scheduled_end_seconds: trip.scheduled_end_seconds,
    });
    byBlock.set(trip.block, list);
  }
  const sheets = [...byBlock].map(([block, blockTrips]) => {
    blockTrips.sort((a, b) => a.scheduled_start_seconds - b.scheduled_start_seconds || a.trip_id.localeCompare(b.trip_id));
    return {
      block,
      garage: garageOn(garages, block, serviceDate),
      first_start_seconds: blockTrips[0].scheduled_start_seconds,
      trips: blockTrips,
      pages: pageCount(blockTrips.length),
      fingerprint: sheetFingerprint(blockTrips),
      order: 0,
    };
  });
  const chosen = inGarage(sheets, garage);
  // Pull-out order within each garage; with every garage chosen, garages read
  // by name with Unassigned last, as the worklist shows them.
  chosen.sort((a, b) =>
    (a.garage === b.garage ? 0 : a.garage === null ? 1 : b.garage === null ? -1 : a.garage.localeCompare(b.garage))
    || a.first_start_seconds - b.first_start_seconds
    || a.block.localeCompare(b.block));
  const counters = new Map<string | null, number>();
  for (const sheet of chosen) {
    const n = (counters.get(sheet.garage) ?? 0) + 1;
    counters.set(sheet.garage, n);
    sheet.order = n;
  }
  return chosen;
}

/**
 * The link the QR code carries (spec §15): the operator app's address, the
 * service date and the block, with `?p=N` on a continuation page. The scan box
 * and the batch splitter read only the path, so the host can change when the
 * operator app gets its own without the sheet's format changing.
 */
export function sheetLink(base: string, serviceDate: string, block: string, page = 1): string {
  return `${base}/r/${serviceDate}/${block}${page > 1 ? `?p=${page}` : ""}`;
}

/**
 * The link base as printed: https (or http on localhost, for a dev console),
 * no query or fragment, no trailing slash. Null when it is not a usable address.
 */
export function normalizeLinkBase(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.search || url.hash || url.username || url.password) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * Where the QR link points: the configured operator app, else the console that
 * printed. The console's address is taken only when it is the origin the
 * request came from, so a print can't point the codes at some other site.
 */
export function linkBaseFor(
  requested: unknown,
  requestOrigin: string | null,
  configured: string | undefined = process.env.RIDERSHIP_SHEET_LINK_BASE,
): string | null {
  const fixed = normalizeLinkBase(configured);
  if (fixed) return fixed;
  const base = normalizeLinkBase(requested);
  if (!base || !requestOrigin) return null;
  try {
    return new URL(base).origin === new URL(requestOrigin).origin ? base : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the print log

/**
 * Where a sheet stands against the log: never printed, printed and still what
 * the Dispatch Log says, or printed but changed since (the desk holds a stale
 * copy). A block printed only for another garage counts as printed: the copy
 * exists, whoever printed it.
 */
export type PrintState = "not_printed" | "printed" | "changed";

export interface PrintStatusSheet {
  block: string;
  garage: string | null;
  order: number;
  first_start_seconds: number;
  trips: number;
  pages: number;
  state: PrintState;
  printed_at: string | null;
  printed_by: string | null;
}

export interface PrintRunView {
  printed_at: string;
  printed_by: string;
  scope: PrintScope;
  sheets: number;
  pages: number;
  blank_backs: boolean;
}

export interface PrintStatus {
  service_date: string;
  /** Absent when every garage was asked for. */
  garage?: string | null;
  /** Garages with sheets on the date; null is Unassigned. */
  garages: (string | null)[];
  sheets: PrintStatusSheet[];
  /** The garage's latest whole-stack print, or null when it has none. */
  last_print: PrintRunView | null;
  /** Every print of the chosen garage that day, newest first. */
  prints: PrintRunView[];
  not_printed: number;
  changed: number;
  /**
   * Blocks this garage printed that the Dispatch Log no longer runs on the
   * date: the desk handed out a sheet for a block that is gone.
   */
  dropped: { block: string; printed_at: string; printed_by: string }[];
}

const runView = (run: StoredPrintRun): PrintRunView => ({
  printed_at: run.printed_at.toISOString(),
  printed_by: run.printed_by,
  scope: run.scope,
  sheets: run.sheet_count,
  pages: run.page_count,
  blank_backs: run.blank_backs,
});

export function printStatus(
  serviceDate: string,
  garage: GarageChoice,
  allSheets: readonly PrintSheet[],
  log: { runs: readonly StoredPrintRun[]; sheets: readonly StoredPrintedSheet[] },
): PrintStatus {
  // The log arrives newest first, so the first row per block is its latest print.
  const latest = new Map<string, StoredPrintedSheet>();
  for (const row of log.sheets) if (!latest.has(row.block)) latest.set(row.block, row);

  const sheets = inGarage(allSheets, garage).map((s): PrintStatusSheet => {
    const printed = latest.get(s.block);
    return {
      block: s.block,
      garage: s.garage,
      order: s.order,
      first_start_seconds: s.first_start_seconds,
      trips: s.trips.length,
      pages: s.pages,
      state: !printed ? "not_printed" : printed.fingerprint === s.fingerprint ? "printed" : "changed",
      printed_at: printed?.printed_at.toISOString() ?? null,
      printed_by: printed?.printed_by ?? null,
    };
  });
  const runs = inGarage(log.runs, garage);
  const running = new Set(allSheets.map((s) => s.block));
  const dropped = inGarage([...latest.values()], garage)
    .filter((row) => !running.has(row.block))
    .sort((a, b) => a.block.localeCompare(b.block))
    .map((row) => ({ block: row.block, printed_at: row.printed_at.toISOString(), printed_by: row.printed_by }));
  const lastStack = runs.find((r) => r.scope === "garage");
  const garages = [...new Set(allSheets.map((s) => s.garage))];
  return {
    service_date: serviceDate,
    ...(garage === undefined ? {} : { garage }),
    garages,
    sheets,
    last_print: lastStack ? runView(lastStack) : null,
    prints: runs.map(runView),
    not_printed: sheets.filter((s) => s.state === "not_printed").length,
    changed: sheets.filter((s) => s.state === "changed").length,
    dropped,
  };
}

// ---------------------------------------------------------------- operations

async function sheetsFor(executor: Executor, serviceDate: string): Promise<PrintSheet[]> {
  const [trips, garages] = await Promise.all([
    loadLoggedTrips(executor, { from: serviceDate, to: serviceDate }),
    loadBlockGarages(executor),
  ]);
  return sheetsToPrint(trips, garages, serviceDate, undefined);
}

export async function loadPrintStatus(executor: Executor, serviceDate: string, garage: GarageChoice): Promise<PrintStatus> {
  const [sheets, log] = await Promise.all([sheetsFor(executor, serviceDate), loadPrintLog(executor, serviceDate)]);
  return printStatus(serviceDate, garage, sheets, log);
}

export interface PrintRequest {
  service_date: string;
  /** null is Unassigned; a garage must be chosen, so a desk never prints another garage's stack. */
  garage: string | null;
  /** Reprint just these blocks; absent prints the garage's whole stack. */
  blocks?: string[];
  blank_backs: boolean;
  link_base: string;
}

export type PrintResult =
  | { kind: "printed"; pdf: Buffer; filename: string; sheets: number; pages: number }
  | { kind: "nothing"; message: string };

const fileSafe = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "garage";

/**
 * Renders the garage's sheets (or the reprinted blocks) as one PDF and logs
 * the print in the same transaction, so a logged print always produced a PDF
 * and a PDF is never handed out unlogged.
 */
export async function printCountSheets(pool: sql.ConnectionPool, input: PrintRequest, actor: string, now: Date = new Date()): Promise<PrintResult> {
  const all = await sheetsFor(pool, input.service_date);
  const stack = inGarage(all, input.garage);
  const label = input.garage ?? "Unassigned";
  if (stack.length === 0) return { kind: "nothing", message: `No blocks are assigned to ${label} on ${input.service_date}.` };

  let chosen = stack;
  if (input.blocks) {
    const wanted = new Set(input.blocks);
    chosen = stack.filter((s) => wanted.has(s.block));
    const missing = input.blocks.filter((b) => !chosen.some((s) => s.block === b));
    if (missing.length > 0) {
      return { kind: "nothing", message: `Block ${missing.join(", ")} has no trips for ${label} on ${input.service_date}.` };
    }
  }

  const pdf = await renderCountSheets({
    serviceDate: input.service_date,
    sheets: chosen,
    stackSize: stack.length,
    linkBase: input.link_base,
    printedAt: now,
    blankBacks: input.blank_backs,
  });
  const pages = chosen.reduce((sum, s) => sum + s.pages, 0) * (input.blank_backs ? 2 : 1);

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await writePrintRun(tx, {
      service_date: input.service_date,
      garage: input.garage,
      scope: input.blocks ? "blocks" : "garage",
      blank_backs: input.blank_backs,
      page_count: pages,
      sheets: chosen.map((s) => ({ block: s.block, fingerprint: s.fingerprint, pages: s.pages })),
    }, actor, now);
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => undefined);
    throw err;
  }

  const suffix = input.blocks ? "-reprint" : "";
  return {
    kind: "printed",
    pdf,
    filename: `count-sheets-${input.service_date}-${fileSafe(label)}${suffix}.pdf`,
    sheets: chosen.length,
    pages,
  };
}
