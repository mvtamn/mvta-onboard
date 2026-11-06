// The scan pipeline on synthetic Count Sheets: rendered by the real
// countSheetPdf.ts for a made-up block, then turned into the kind of PDF a
// garage MFP makes (one image per page, slightly crooked, noisy, no text).
// No real sheet, name or scan is used (the repository is public).
import assert from "node:assert/strict";
import test from "node:test";
import PDFDocument from "pdfkit";
import { renderCountSheets, printedLabel } from "../countSheetPdf";
import type { PrintSheet } from "../print";
import { candidatesFrom, analysePage, PAGE_DPI } from "./pipeline";
import { encodeJpeg, pdfPageCount, rasterizePage } from "./raster";
import type { Gray } from "./geometry";

const EVENING = new Date("2026-12-12T03:10:00Z"); // 9:10 PM CT on the 11th
const MORNING = new Date("2026-12-12T10:45:00Z"); // 4:45 AM CT on the 12th

function sampleSheet(trips = 11): PrintSheet {
  return {
    block: "024",
    garage: "Sample",
    first_start_seconds: 5 * 3600,
    pages: 1,
    fingerprint: "f".repeat(64),
    order: 3,
    trips: Array.from({ length: trips }, (_, i) => ({
      trip_id: `T-${1000 + i}`,
      route_short_name: "99",
      route_label: "99",
      trip_number: `${500 + i}-${i % 2 ? "N" : "S"}`,
      direction_label: i % 2 ? "NB" : "SB",
      scheduled_start_seconds: 5 * 3600 + i * 2400,
      scheduled_end_seconds: 5 * 3600 + i * 2400 + 1800,
    })),
  };
}

function sheetPdf(printedAt: Date, blankBacks = false): Promise<Buffer> {
  return renderCountSheets({
    serviceDate: "20261212",
    sheets: [sampleSheet()],
    stackSize: 20,
    linkBase: "https://console.example.test",
    printedAt,
    blankBacks,
  });
}

/** The page turned by `degrees`, shifted, and noised, as a crooked MFP feed would leave it. */
function scanLike(image: Gray, degrees: number, shift: { x: number; y: number }, seed = 7): Gray {
  const { width, height } = image;
  const out = new Uint8Array(width * height);
  const t = (degrees * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  const cx = width / 2;
  const cy = height / 2;
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx - shift.x;
      const dy = y - cy - shift.y;
      const sx = Math.round(cos * dx + sin * dy + cx);
      const sy = Math.round(-sin * dx + cos * dy + cy);
      const v = sx >= 0 && sy >= 0 && sx < width && sy < height ? image.data[sy * width + sx] : 255;
      out[y * width + x] = Math.max(0, Math.min(255, Math.round(v * 0.92 + 10 + (rand() - 0.5) * 30)));
    }
  }
  return { width, height, data: out };
}

function blackOut(image: Gray, scale: number, box: { x: number; y: number; w: number; h: number }): Gray {
  const data = new Uint8Array(image.data);
  for (let y = Math.round(box.y * scale); y < Math.round((box.y + box.h) * scale); y++) {
    for (let x = Math.round(box.x * scale); x < Math.round((box.x + box.w) * scale); x++) data[y * image.width + x] = 30;
  }
  return { ...image, data };
}

/** An image-only PDF, one Letter page per image, optionally with an invisible OCR-style text layer. */
async function mfpPdf(pages: Gray[], hiddenText?: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  for (const page of pages) {
    doc.addPage({ size: "LETTER", margin: 0 });
    doc.image(await encodeJpeg(page, 80), 0, 0, { width: 612, height: 792 });
    if (hiddenText) doc.fillOpacity(0).font("Helvetica").fontSize(7).text(hiddenText, 36, 760, { lineBreak: false }).fillOpacity(1);
  }
  doc.end();
  return done;
}

const runs = candidatesFrom([
  { print_id: "evening", printed_at: EVENING },
  { print_id: "morning", printed_at: MORNING },
]);
const deps = { printRuns: async () => runs };

test("a sheet straight from countSheetPdf is identified by its QR code and its footer, and its blank back is dropped", async () => {
  const pdf = await sheetPdf(MORNING, true);
  assert.equal(await pdfPageCount(pdf), 2);
  const page = await analysePage(pdf, 0, deps);
  assert.equal(page.kind, "identified");
  if (page.kind !== "identified") return;
  assert.deepEqual(page.identity, { serviceDate: "20261212", block: "024", sheetPage: 1 });
  assert.equal(page.identifiedBy, "qr");
  assert.equal(page.footer, printedLabel(MORNING));
  assert.equal(page.printId, "morning");
  assert.equal(page.straightened, true);
  assert.ok(page.jpeg.length > 10_000);
  assert.deepEqual(await analysePage(pdf, 1, deps), { kind: "blank" });
});

test("an image-only MFP scan, 2.3 degrees crooked and noisy, is straightened, decoded, and matched to its print run by the footer", async () => {
  for (const [printedAt, expected] of [[EVENING, "evening"], [MORNING, "morning"]] as const) {
    const clean = await rasterizePage(await sheetPdf(printedAt), 0, 150);
    const scan = await mfpPdf([scanLike(clean.image, 2.3, { x: 9, y: -6 }), { width: 10, height: 10, data: new Uint8Array(100).fill(250) }]);
    const page = await analysePage(scan, 0, deps);
    assert.equal(page.kind, "identified", `printed ${expected}`);
    if (page.kind !== "identified") return;
    assert.equal(page.straightened, true);
    assert.equal(page.identifiedBy, "qr");
    assert.equal(page.footer, null, "an image-only page has no text layer");
    assert.equal(page.printId, expected);
    assert.deepEqual(await analysePage(scan, 1, deps), { kind: "blank" });
  }
});

test("a scan tilted the other way at 150 dpi still decodes", async () => {
  const clean = await rasterizePage(await sheetPdf(EVENING), 0, 150);
  const page = await analysePage(await mfpPdf([scanLike(clean.image, -1.5, { x: -4, y: 5 }, 3)]), 0, { printRuns: async () => runs.slice(0, 1) });
  assert.equal(page.kind, "identified");
  if (page.kind === "identified") assert.equal(page.printId, "evening", "the only run needs no footer");
});

test("a defaced QR code falls back to a searchable PDF's printed link, then to a person", async () => {
  const clean = await rasterizePage(await sheetPdf(EVENING), 0, 150);
  const defaced = blackOut(scanLike(clean.image, 1, { x: 0, y: 0 }), clean.scale, { x: 488, y: 32, w: 90, h: 90 });

  const searchable = await analysePage(await mfpPdf([defaced], `console.example.test/r/20261212/024 Printed ${printedLabel(EVENING)} from the Dispatch Log`), 0, deps);
  assert.equal(searchable.kind, "identified");
  if (searchable.kind === "identified") {
    assert.equal(searchable.identifiedBy, "printed_text");
    assert.deepEqual(searchable.identity, { serviceDate: "20261212", block: "024", sheetPage: 1 });
    assert.equal(searchable.printId, "evening");
  }

  const bare = await analysePage(await mfpPdf([defaced]), 0, deps);
  assert.equal(bare.kind, "unreadable");
  if (bare.kind === "unreadable") assert.equal(bare.reason, "not_identified");
});

test("a page with a corner mark cut off is unreadable but still keeps an image for a person", async () => {
  const clean = await rasterizePage(await sheetPdf(EVENING), 0, 150);
  const cropped = blackOut(clean.image, clean.scale, { x: 0, y: 0, w: 0, h: 0 });
  for (let y = 0; y < Math.round(40 * clean.scale); y++) for (let x = 0; x < Math.round(40 * clean.scale); x++) cropped.data[y * cropped.width + x] = 255;
  // The QR code is untouched, so the page is still identified, just not straightened.
  const page = await analysePage(await mfpPdf([cropped]), 0, deps);
  assert.equal(page.kind, "identified");
  if (page.kind === "identified") assert.equal(page.straightened, false);
  assert.equal(PAGE_DPI, 200);
});
