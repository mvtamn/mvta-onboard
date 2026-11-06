// Words for Count Sheet scans (migration 163), shared by Upload scans, the
// worklist and the sheet form.
import type { RidershipScanPage, RidershipScanPageState, RidershipScanUpload } from "@mvta/shared";

export const SCAN_PAGE_LABEL: Record<RidershipScanPageState, string> = {
  pending: "Reading",
  matched: "Recognised",
  blank: "Blank page",
  duplicate: "Second copy",
  superseded: "Older print",
  unreadable: "Needs you",
  ignored: "Set aside",
};

export const SCAN_PAGE_TONE: Record<RidershipScanPageState, "ok" | "warn" | "bad" | "muted" | "accent"> = {
  pending: "muted",
  matched: "ok",
  blank: "muted",
  duplicate: "warn",
  superseded: "muted",
  unreadable: "bad",
  ignored: "muted",
};

const REASON: Record<string, string> = {
  marks_missing: "A corner mark is missing: was the page cut off or folded?",
  marks_implausible: "The page did not scan straight enough to read.",
  marks_not_confirmed: "The page did not scan straight enough to read.",
  not_identified: "The QR code could not be read.",
  processing_failed: "OnBoard could not process this page.",
};

/** One line on how a page was identified, or why it was not. */
export function scanPageNote(page: RidershipScanPage): string {
  if (page.state === "pending") return "Waiting to be read.";
  if (page.state === "unreadable") return REASON[page.reason ?? ""] ?? "Not recognised.";
  if (page.state === "blank") return page.assigned_by ? `Marked blank by ${page.assigned_by}.` : "The back of a sheet. Nothing kept.";
  if (page.state === "ignored") return `Set aside by ${page.assigned_by ?? "someone"}.`;
  const how = page.identified_by === "person" ? `Typed by ${page.assigned_by ?? "someone"}`
    : page.identified_by === "printed_text" ? "Read from the printed block and date" : "Read from the QR code";
  const copy = page.state === "duplicate" ? "; the sheet was already scanned"
    : page.state === "superseded" ? "; a later print of this sheet was scanned" : "";
  return `${how}${copy}.`;
}

/** "12 pages · 10 recognised · 1 blank · 1 needs you", or where processing stands. */
export function scanUploadSummary(upload: RidershipScanUpload): string {
  if (upload.status === "failed") return "Not processed";
  if (upload.status === "awaiting") return "Upload not finished";
  if (upload.status === "queued" || upload.status === "splitting") return "Waiting to be read";
  const count = (state: RidershipScanPageState) => upload.pages.filter((p) => p.state === state).length;
  const parts = [`${upload.page_count ?? upload.pages.length} page${(upload.page_count ?? upload.pages.length) === 1 ? "" : "s"}`];
  for (const [state, word] of [["matched", "recognised"], ["duplicate", "second copies"], ["superseded", "older prints"], ["blank", "blank"], ["unreadable", "need you"], ["pending", "still reading"]] as const) {
    const n = count(state);
    if (n > 0) parts.push(`${n} ${n === 1 && state === "unreadable" ? "needs you" : n === 1 && state === "duplicate" ? "second copy" : n === 1 && state === "superseded" ? "older print" : word}`);
  }
  return parts.join(" · ");
}
