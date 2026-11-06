// Which sheet a scanned page is, and which printed copy of it
// (plans/count-sheet-scan-upload.md §2 steps 3-5). Pure rules: the pipeline
// gathers the evidence, these decide.
import { isServiceDate, normalizeBlock } from "../rules";
import type { TextItem } from "./raster";

export interface SheetIdentity {
  serviceDate: string;
  block: string;
  /** 1 for the first page; a continuation page's QR code carries ?p=2. */
  sheetPage: number;
}

/**
 * The QR code's link (spec §15): `…/r/<YYYYMMDD>/<block>`, plus `?p=N` on a
 * continuation page. Only the path is read, so the host can change. The
 * footer prints the same link without its scheme, so a text layer is read
 * with this too.
 */
export function parseSheetLink(text: string): SheetIdentity | null {
  const match = /\/r\/(\d{8})\/(\d{1,3})(?![\d])\/?(?:\?p=(\d{1,2}))?/.exec(text);
  if (!match) return null;
  const [, serviceDate, rawBlock, rawPage] = match;
  const block = normalizeBlock(rawBlock);
  if (!isServiceDate(serviceDate) || !block) return null;
  const sheetPage = rawPage ? Number(rawPage) : 1;
  if (!Number.isInteger(sheetPage) || sheetPage < 1) return null;
  return { serviceDate, block, sheetPage };
}

/** "Printed 2026-12-12 9:10 PM CT from the Dispatch Log" -> "2026-12-12 9:10 PM CT", as printedLabel writes it. */
export function parseFooterLabel(text: string): string | null {
  const match = /Printed (\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2}) (AM|PM) CT/.exec(text);
  return match ? `${match[1]} ${Number(match[2])}:${match[3]} ${match[4]} CT` : null;
}

export interface TextLayerReading {
  identity: SheetIdentity | null;
  footer: string | null;
  blank: boolean;
}

/**
 * What a page's text layer says. A searchable PDF (an MFP with OCR on), or a
 * sheet straight from countSheetPdf, carries the printed words: the footer
 * link first, then the large BLOCK number and the date beside it, then
 * "Page n of N" for the page.
 */
export function readTextLayer(items: readonly TextItem[]): TextLayerReading {
  const joined = items.map((i) => i.str).join(" ");
  const blank = /intentionally blank/i.test(joined) && items.length <= 3;
  const footer = parseFooterLabel(joined);
  const fromLink = parseSheetLink(joined.replace(/\s+/g, " ").replace(/ ?\/ ?/g, "/").replace(/ ?\? ?p ?= ?/g, "?p="));
  if (fromLink) return { identity: fromLink, footer, blank };

  const blockItem = items
    .filter((i) => /^\s*\d{1,3}\s*$/.test(i.str) && i.height >= 20)
    .sort((a, b) => b.height - a.height)[0];
  const dateItem = items.find((i) => /^\s*\d{4}-\d{2}-\d{2}\s*$/.test(i.str) && i.height >= 9);
  const block = blockItem ? normalizeBlock(blockItem.str.trim()) : null;
  const serviceDate = dateItem ? dateItem.str.trim().replace(/-/g, "") : null;
  const pageMatch = /Page (\d{1,2}) of \d{1,2}/.exec(joined);
  if (block && serviceDate && isServiceDate(serviceDate)) {
    return { identity: { serviceDate, block, sheetPage: pageMatch ? Number(pageMatch[1]) : 1 }, footer, blank };
  }
  return { identity: null, footer, blank };
}

export interface PrintRunCandidate {
  print_id: string;
  printed_at: Date;
  /** printedLabel(printed_at): the footer as that run printed it. */
  label: string;
}

/**
 * The print run a page came from (§2 step 4). The code names the sheet, not
 * the copy, so the footer's print time decides between an evening print and
 * a morning reprint. With the footer read as text, the run whose label it is
 * (the newest, if two printed within one minute). Without text, the only run
 * when there is one; otherwise the run whose rendered footer best matches the
 * scan's, when it clearly beats the next best. Null: not known.
 */
export function choosePrintRun(
  runs: readonly PrintRunCandidate[],
  footer: string | null,
  imageScores?: ReadonlyMap<string, number>,
): string | null {
  if (runs.length === 0) return null;
  const newestFirst = [...runs].sort((a, b) => b.printed_at.getTime() - a.printed_at.getTime());
  if (footer) return newestFirst.find((r) => r.label === footer)?.print_id ?? null;
  if (runs.length === 1) return runs[0].print_id;
  if (!imageScores) return null;
  const scored = newestFirst
    .map((r) => ({ id: r.print_id, score: imageScores.get(r.print_id) ?? -1 }))
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  return best.score >= 0.5 && best.score - (next?.score ?? -1) >= 0.03 ? best.id : null;
}

export type PageState = "pending" | "matched" | "blank" | "duplicate" | "superseded" | "unreadable" | "ignored";

export interface ExistingPage {
  page_id: string;
  /** When the copy it came from was printed; null when the run is not known. */
  printed_at: Date | null;
}

/**
 * A second page with the same date, block and page (§2 step 5). It is kept
 * either way. From a newer print run it becomes the sheet's page and the
 * older ones are superseded; from an older run it is itself superseded; from
 * the same run, or with either run unknown, it is a duplicate.
 */
export function duplicateOutcome(
  existing: readonly ExistingPage[],
  printedAt: Date | null,
): { state: "matched" | "duplicate" | "superseded"; supersede: string[] } {
  if (existing.length === 0) return { state: "matched", supersede: [] };
  if (printedAt === null || existing.some((e) => e.printed_at === null)) return { state: "duplicate", supersede: [] };
  const newestExisting = Math.max(...existing.map((e) => e.printed_at!.getTime()));
  if (printedAt.getTime() > newestExisting) return { state: "matched", supersede: existing.map((e) => e.page_id) };
  if (printedAt.getTime() < newestExisting) return { state: "superseded", supersede: [] };
  return { state: "duplicate", supersede: [] };
}

/** A QR date more than two days from the upload (§2 step 7): an old sheet reused, or a photocopy. */
export function dateLooksWrong(serviceDate: string, uploadedServiceDate: string): boolean {
  const day = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
  return Math.abs(day(serviceDate) - day(uploadedServiceDate)) > 2 * 86_400_000;
}
