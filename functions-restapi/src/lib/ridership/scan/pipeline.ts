// One scanned page, from PDF bytes to "this is block 024 on 12 Dec, from the
// 9:10 PM print" (plans/count-sheet-scan-upload.md §2, increment S1: capture
// only, nothing handwritten is read).
//
//   1. Draw the page at 200 dpi.
//   2. A blank back (almost no ink, or only "This side intentionally blank")
//      is dropped and no image is kept.
//   3. Straighten it on the four corner marks.
//   4. Decode the QR code where it is printed; failing that, anywhere on the
//      page; failing that, the printed BLOCK, date and footer link from the
//      PDF's text layer (a searchable PDF). Failing all three, a person
//      assigns the page.
//   5. Find the print run from the footer's print time: read as text when
//      the PDF has a text layer, or else by comparing the scan's footer with
//      the footer each candidate run printed.
//
// No OCR runs here. Reading printed text from a bare image arrives with
// Document Intelligence in S3; until then an image-only page whose code will
// not decode goes to a person.
import jsQR from "jsqr";
import PDFDocument from "pdfkit";
import { printedLabel } from "../countSheetPdf";
import { bestCorrelation, cropPt, looksBlank, straighten, toRgba, type Gray } from "./geometry";
import { choosePrintRun, parseSheetLink, readTextLayer, type PrintRunCandidate, type SheetIdentity } from "./identify";
import { encodeJpeg, rasterizePage } from "./raster";

/** Enough for OCC to read a handwritten digit from the stored page image. */
export const PAGE_DPI = 200;
const SCALE = PAGE_DPI / 72;

/** Where the QR code is printed (countSheetPdf.ts header: up to 30 mm, top right, from y 34), clear of the corner mark. */
const QR_BOX_PT = { x: 476, y: 30, w: 105, h: 96 };
/** The footer's print time, right-aligned on the line at y 742 (countSheetPdf.ts footer). */
const FOOTER_BOX_PT = { x: 380, y: 738.5, w: 200, h: 11 };

export type PageAnalysis =
  | { kind: "blank" }
  | {
    kind: "identified";
    identity: SheetIdentity;
    identifiedBy: "qr" | "printed_text";
    qrText: string | null;
    footer: string | null;
    printId: string | null;
    straightened: boolean;
    jpeg: Buffer;
  }
  | { kind: "unreadable"; reason: string; jpeg: Buffer };

export interface PipelineDeps {
  /** Every print of the sheet's date that carried the block, as candidates. */
  printRuns(serviceDate: string, block: string): Promise<PrintRunCandidate[]>;
}

export function decodeQr(image: Gray): string | null {
  if (image.width === 0 || image.height === 0) return null;
  const found = jsQR(toRgba(image), image.width, image.height, { inversionAttempts: "dontInvert" });
  return found?.data ?? null;
}

/** The footer as a run with this print time printed it, drawn the way the scan was. */
async function renderedFooter(label: string): Promise<Gray> {
  const doc = new PDFDocument({ size: "LETTER", margin: 0 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  // Same font, size and placement as countSheetPdf.ts's footer, which this
  // copies rather than calls so the print path is not touched.
  doc.fillColor("#000").font("Helvetica").fontSize(7).text(`Printed ${label} from the Dispatch Log`, 36, 742, { width: 540, align: "right", lineBreak: false });
  doc.end();
  const page = await rasterizePage(await done, 0, PAGE_DPI);
  return cropPt(page.image, page.scale, FOOTER_BOX_PT);
}

async function footerScores(straight: Gray, runs: readonly PrintRunCandidate[]): Promise<Map<string, number>> {
  const scan = cropPt(straight, SCALE, FOOTER_BOX_PT);
  const scores = new Map<string, number>();
  const byLabel = new Map<string, number>();
  for (const run of runs) {
    if (!byLabel.has(run.label)) byLabel.set(run.label, bestCorrelation(await renderedFooter(run.label), scan));
    scores.set(run.print_id, byLabel.get(run.label)!);
  }
  return scores;
}

export async function analysePage(pdf: Uint8Array, pageIndex: number, deps: PipelineDeps): Promise<PageAnalysis> {
  const raster = await rasterizePage(pdf, pageIndex, PAGE_DPI);
  const text = readTextLayer(raster.text);
  if (text.blank || looksBlank(raster.image)) return { kind: "blank" };

  const straight = straighten(raster.image, raster.scale, SCALE);
  const image = straight.ok ? straight.image : raster.image;

  let qrText = straight.ok ? decodeQr(cropPt(image, SCALE, QR_BOX_PT)) : null;
  qrText ??= decodeQr(image);
  const fromQr = qrText ? parseSheetLink(qrText) : null;
  const identity = fromQr ?? text.identity;
  const jpeg = await encodeJpeg(image);

  if (!identity) {
    const reason = straight.ok ? "not_identified" : straight.reason;
    return { kind: "unreadable", reason, jpeg };
  }

  const runs = await deps.printRuns(identity.serviceDate, identity.block);
  const scores = !text.footer && runs.length > 1 && straight.ok ? await footerScores(image, runs) : undefined;
  return {
    kind: "identified",
    identity,
    identifiedBy: fromQr ? "qr" : "printed_text",
    qrText,
    footer: text.footer,
    printId: choosePrintRun(runs, text.footer, scores),
    straightened: straight.ok,
    jpeg,
  };
}

/** Print-log rows as candidates, each with the footer label it printed. */
export function candidatesFrom(runs: readonly { print_id: string; printed_at: Date }[]): PrintRunCandidate[] {
  return runs.map((r) => ({ print_id: r.print_id, printed_at: r.printed_at, label: printedLabel(r.printed_at) }));
}
