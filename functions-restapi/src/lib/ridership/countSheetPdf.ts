// The printed Count Sheet (spec §3, design agreed 2026-10-31 from the
// prototype on claude/ridership-ui-0aa433). Written on with a pen on a moving
// bus, and read twice: by OCC from Dec 1, and by the scan reader with the
// kiosk pilot (§15). So:
//   * totals go in one-digit boxes and DNO is a box to tick, which a person
//     and a handwriting reader both read far better than free text;
//   * four solid corner marks and the QR code let a scan be straightened and
//     matched to its block, date and page;
//   * the trips are printed, so nothing needs the operator to know a code;
//     each is named as Avail and dispatch name it ("320-E"), not by GTFS id.
// A PDF rather than browser printing (evaluation 2026-10-31): fixed US Letter,
// no browser margins or "background graphics" setting, the same on every
// garage PC. Every rule and box is a stroke, never a fill behind text, and the
// page is always black on white.
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { TRIPS_PER_PAGE, sheetLink, type PrintSheet, type PrintTrip } from "./print";

const PAGE = { width: 612, height: 792 }; // US Letter in points
const MARGIN = 36;
const RIGHT = PAGE.width - MARGIN;
const MM = 72 / 25.4;
/** About 25 mm square, quiet zone included (build plan decision 2)... */
const QR_MIN = 25 * MM;
/** ...grown for a long link so a module stays about 0.7 mm, up to 30 mm. */
const QR_MAX = 30 * MM;
const QR_MODULE = 0.7 * MM;
/** The rule under the header: the largest code (30 mm from y 34) ends above it. */
const RULE_Y = 122;
const DIGIT = 16;
/** 24 rather than 26 since the relief line (migration 162): a full last page still clears the footer. */
const TRIP_ROW = 24;
/** The operator rows - the one who pulled out, and a relief or bus change - then How to count. */
const OPERATOR_ROW = 32;

const FONT = "Helvetica";
const BOLD = "Helvetica-Bold";
const MONO = "Courier";
const MONO_BOLD = "Courier-Bold";
const GUIDE = "#8a8a8a";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface CountSheetInput {
  serviceDate: string;
  sheets: readonly PrintSheet[];
  /** The garage's whole stack, for "pull-out order n of N" on a reprint. */
  stackSize: number;
  linkBase: string;
  printedAt: Date;
  blankBacks: boolean;
}

type Doc = PDFKit.PDFDocument;

const dashedDate = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const weekday = (d: string) => WEEKDAYS[new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)))).getUTCDay()];

/**
 * GTFS seconds as the current guide shows a time (the paper sheet's "Ride
 * Detail", Access): "3:20 AM". A trip after midnight shows 12:40 AM, not 24:40.
 */
export function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60) % (24 * 60);
  const h = Math.floor(minutes / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(minutes % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** GTFS "EB"/"NB" as the guide writes it: E, N, S, W. Anything else as it is. */
export function directionLetter(label: string | null): string {
  if (!label) return "";
  const match = label.trim().toUpperCase().match(/^([NSEW])(B|BOUND)?$/);
  return match ? match[1] : label;
}

/** The print time in Central, as the footer shows it. */
export function printedLabel(at: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hourCycle: "h12",
  }).formatToParts(at).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase().replace(/\./g, "")} CT`;
}

function box(doc: Doc, x: number, y: number, w: number, h: number, width = 0.8) {
  doc.lineWidth(width).strokeColor("#000").rect(x, y, w, h).stroke();
}

function digitBoxes(doc: Doc, x: number, y: number, n: number): number {
  for (let i = 0; i < n; i++) box(doc, x + i * DIGIT, y, DIGIT, DIGIT + 2);
  return n * DIGIT;
}

function tickBox(doc: Doc, x: number, y: number, size = 11) {
  box(doc, x, y, size, size);
}

/** A baseline split into six cells, to keep strokes in rows of five. */
function tallyGuides(doc: Doc, x: number, y: number, w: number, h: number) {
  doc.save().lineWidth(0.4).strokeColor(GUIDE);
  doc.moveTo(x, y + h).lineTo(x + w, y + h).stroke();
  for (let i = 1; i < 6; i++) {
    const gx = x + (w * i) / 6;
    doc.moveTo(gx, y + h * 0.35).lineTo(gx, y + h).stroke();
  }
  doc.restore();
}

type Qr = ReturnType<typeof QRCode.create>;
const qrFor = (text: string): Qr => QRCode.create(text, { errorCorrectionLevel: "Q" });
/** 25 mm, or larger for a dense link, never past 30 mm; the quiet zone is a module each side. */
const sideFor = (qr: Qr) => Math.min(QR_MAX, Math.max(QR_MIN, (qr.modules.size + 2) * QR_MODULE));

/** The code's side in points for a link. */
export const qrSide = (text: string): number => sideFor(qrFor(text));

/** QR modules as squares, error correction Q, a one-module quiet zone inside the side. */
function qrCode(doc: Doc, qr: Qr, x: number, y: number, size: number) {
  const n = qr.modules.size;
  const cell = size / (n + 2);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) doc.rect(x + (c + 1) * cell, y + (r + 1) * cell, cell, cell);
    }
  }
  doc.fillColor("#000").fill();
}

function cornerMarks(doc: Doc) {
  const s = 12;
  const inset = 18;
  for (const [x, y] of [[inset, inset], [PAGE.width - inset - s, inset], [inset, PAGE.height - inset - s], [PAGE.width - inset - s, PAGE.height - inset - s]]) {
    doc.rect(x, y, s, s).fillColor("#000").fill();
  }
}

function header(doc: Doc, serviceDate: string, sheet: PrintSheet, link: string) {
  const top = 40;
  doc.fillColor("#000").font(BOLD).fontSize(7.5).text("MINNESOTA VALLEY TRANSIT AUTHORITY", MARGIN, top, { lineBreak: false });
  doc.font(BOLD).fontSize(16).text("Passenger Count Sheet", MARGIN, top + 13, { lineBreak: false });
  doc.font(FONT).fontSize(10).text(`Fixed route · ${sheet.garage ?? "Unassigned"} garage`, MARGIN, top + 36, { lineBreak: false });

  // The manual fallback when a code won't scan: block and date in large type.
  const bx = 236;
  box(doc, bx, top - 2, 92, 62, 1.6);
  doc.font(BOLD).fontSize(8).text("BLOCK", bx, top + 3, { width: 92, align: "center", lineBreak: false });
  doc.font(BOLD).fontSize(34).text(sheet.block, bx, top + 15, { width: 92, align: "center", lineBreak: false });
  doc.font(BOLD).fontSize(13).text(dashedDate(serviceDate), bx + 102, top + 14, { lineBreak: false });
  doc.font(FONT).fontSize(10).text(weekday(serviceDate), bx + 102, top + 31, { lineBreak: false });

  const qr = qrFor(link);
  const side = sideFor(qr);
  const qx = RIGHT - side;
  // Below the corner mark's row, and the largest code still clears the rule.
  const qy = top - 6;
  qrCode(doc, qr, qx, qy, side);
  doc.font(FONT).fontSize(7).text("Scan to enter counts", qx - 92, top + 12, { width: 86, align: "right", lineBreak: false });
  doc.text("on the kiosk or web", qx - 92, top + 21, { width: 86, align: "right", lineBreak: false });
  doc.font(BOLD).text("Sign-in required", qx - 92, top + 30, { width: 86, align: "right", lineBreak: false });

  doc.lineWidth(1.2).moveTo(MARGIN, RULE_Y).lineTo(RIGHT, RULE_Y).stroke();
}

function operatorSection(doc: Doc) {
  const y = RULE_Y + 4;
  doc.font(FONT).fontSize(7).fillColor("#000");
  doc.text("Operator name", MARGIN, y, { lineBreak: false });
  doc.lineWidth(0.8).moveTo(MARGIN, y + 28).lineTo(MARGIN + 200, y + 28).stroke();

  let x = MARGIN + 216;
  doc.text("Operator ID", x, y, { lineBreak: false });
  x += digitBoxes(doc, x, y + 10, 5) + 14;
  doc.text("Bus #", x, y, { lineBreak: false });
  x += digitBoxes(doc, x, y + 10, 4) + 14;
  doc.text("Initials", x, y, { lineBreak: false });
  box(doc, x, y + 10, 40, DIGIT + 2);

  // Operators are assigned and buses joined on the day, after this prints, so
  // a relief or a swapped bus is written here. Same columns as the row above;
  // the trip # is the row number in the table below.
  const r = y + OPERATOR_ROW;
  doc.font(BOLD).text("Relief or bus change: operator name", MARGIN, r, { continued: true });
  doc.font(FONT).text("  (blank if none)", { lineBreak: false });
  doc.lineWidth(0.8).moveTo(MARGIN, r + 28).lineTo(MARGIN + 200, r + 28).stroke();
  x = MARGIN + 216;
  doc.text("Operator ID", x, r, { lineBreak: false });
  x += digitBoxes(doc, x, r + 10, 5) + 14;
  doc.text("Bus #", x, r, { lineBreak: false });
  x += digitBoxes(doc, x, r + 10, 4) + 14;
  doc.text("Initials", x, r, { lineBreak: false });
  box(doc, x, r + 10, 40, DIGIT + 2);
  x += 40 + 14;
  doc.font(BOLD).text("From trip #", x, r, { lineBreak: false });
  digitBoxes(doc, x, r + 10, 2);
}

function howToCount(doc: Doc) {
  const y = RULE_Y + 38 + OPERATOR_ROW;
  box(doc, MARGIN, y, RIGHT - MARGIN, 30, 0.6);
  doc.fillColor("#000").font(BOLD).fontSize(7.5).text("How to count: ", MARGIN + 6, y + 5, { width: RIGHT - MARGIN - 12, continued: true });
  doc.font(FONT).text(
    "make one stroke in Tally for every boarding, including transfers and fare-free riders. At the end of the trip write the total, one digit per box (for 27 riders write 0 2 7). "
    + "Trip did not run? Tick DNO and leave the total blank. Zero riders? Write 0.",
    { width: RIGHT - MARGIN - 12 },
  );
}

// The Trip column prints Avail's trip number ("320-E", "1235-N"). A trip whose
// id is not in MVTA's form prints the GTFS id instead, shrunk to fit.
const TRIP_COLUMNS = { n: 18, route: 40, dir: 22, scheduled: 92, trip: 84, total: 3 * DIGIT + 10, dno: 30 };

function tripTable(doc: Doc, trips: readonly PrintTrip[], firstNumber: number): number {
  const c = TRIP_COLUMNS;
  const tallyWidth = RIGHT - MARGIN - (c.n + c.route + c.dir + c.scheduled + c.trip + c.total + c.dno);
  const xs = [MARGIN];
  for (const w of [c.n, c.route, c.dir, c.scheduled, c.trip, tallyWidth, c.total]) xs.push(xs[xs.length - 1] + w);

  let y = RULE_Y + 76 + OPERATOR_ROW;
  const heads = ["#", "Route", "Dir", "Ride", "Trip", "Tally", "Total boardings", "DNO"];
  doc.font(BOLD).fontSize(7).fillColor("#000");
  heads.forEach((h, i) => doc.text(h, xs[i] + 2, y + 3, { lineBreak: false }));
  y += 13;
  doc.lineWidth(0.8).moveTo(MARGIN, y).lineTo(RIGHT, y).stroke();

  trips.forEach((trip, i) => {
    const mid = y + TRIP_ROW / 2;
    doc.font(FONT).fontSize(8).text(String(firstNumber + i), xs[0] + 2, mid - 4, { lineBreak: false });
    // The guide's route number; anything longer shrinks to its column rather than run into the next.
    const route = trip.route_label ?? "?";
    doc.font(BOLD).fontSize(14);
    const routeSize = Math.min(14, (14 * (c.route - 4)) / Math.max(1, doc.widthOfString(route)));
    doc.fontSize(routeSize).text(route, xs[1] + 2, mid - routeSize / 2, { lineBreak: false });
    doc.font(BOLD).fontSize(14).text(directionLetter(trip.direction_label), xs[2] + 2, mid - 7, { lineBreak: false });
    // The trip as the current paper sheet names it: "5:20 AM - 6:40 AM".
    const span = `${clock(trip.scheduled_start_seconds)} - ${trip.scheduled_end_seconds === null ? "" : clock(trip.scheduled_end_seconds)}`;
    doc.font(BOLD).fontSize(8.5).text(span, xs[3] + 2, mid - 4, { width: c.scheduled - 4, lineBreak: false });
    // Courier is 0.6 em a character: shrink a long GTFS id to fit rather than cut it, since OCC reads it.
    const tripName = trip.trip_number ?? trip.trip_id;
    const idSize = Math.min(trip.trip_number ? 11 : 7.5, (c.trip - 4) / (0.6 * Math.max(1, tripName.length)));
    doc.font(trip.trip_number ? MONO_BOLD : MONO).fontSize(idSize).text(tripName, xs[4] + 2, mid - idSize / 2, { lineBreak: false });
    tallyGuides(doc, xs[5] + 4, y + 4, tallyWidth - 8, TRIP_ROW - 9);
    digitBoxes(doc, xs[6] + 4, mid - (DIGIT + 2) / 2, 3);
    tickBox(doc, xs[7] + 9, mid - 5.5);
    y += TRIP_ROW;
    doc.lineWidth(0.4).strokeColor("#000").moveTo(MARGIN, y).lineTo(RIGHT, y).stroke();
  });
  return y;
}

function unscheduledRows(doc: Doc, top: number): number {
  let y = top + 10;
  doc.fillColor("#000").font(BOLD).fontSize(8).text("Unscheduled trips - trippers, extras, OCC-directed (leave blank if none)", MARGIN, y, { lineBreak: false });
  y += 13;
  const widths = [3 * DIGIT + 8, 62, 4 * DIGIT + 62, 112];
  const xs = [MARGIN];
  for (const w of widths) xs.push(xs[xs.length - 1] + w);
  const totalX = RIGHT - (3 * DIGIT + 4);
  doc.font(BOLD).fontSize(7);
  ["Route", "Dir", "Start", "Why", "Tally"].forEach((h, i) => doc.text(h, xs[i] + 2, y, { lineBreak: false }));
  doc.text("Total boardings", totalX - 6, y, { lineBreak: false });
  y += 10;
  doc.lineWidth(0.8).moveTo(MARGIN, y).lineTo(RIGHT, y).stroke();

  for (let row = 0; row < 3; row++) {
    const mid = y + TRIP_ROW / 2;
    const boxTop = mid - (DIGIT + 2) / 2;
    digitBoxes(doc, xs[0] + 2, boxTop, 3);
    doc.font(BOLD).fontSize(10).text("N  S  E  W", xs[1] + 4, mid - 5, { lineBreak: false });
    digitBoxes(doc, xs[2] + 2, boxTop, 2);
    doc.font(BOLD).fontSize(12).text(":", xs[2] + 2 * DIGIT + 5, mid - 6, { lineBreak: false });
    digitBoxes(doc, xs[2] + 2 * DIGIT + 12, boxTop, 2);
    doc.font(BOLD).fontSize(9).text("AM  PM", xs[2] + 4 * DIGIT + 18, mid - 4.5, { lineBreak: false });
    let wx = xs[3] + 2;
    doc.font(FONT).fontSize(7.5);
    for (const why of ["Tripper", "Extra", "OCC"]) {
      tickBox(doc, wx, mid - 5);
      doc.text(why, wx + 13, mid - 3.5, { lineBreak: false });
      wx += 13 + doc.widthOfString(why) + 8;
    }
    tallyGuides(doc, xs[4] + 4, y + 4, totalX - xs[4] - 16, TRIP_ROW - 9);
    digitBoxes(doc, totalX, boxTop, 3);
    y += TRIP_ROW;
    doc.lineWidth(0.4).moveTo(MARGIN, y).lineTo(RIGHT, y).stroke();
  }
  return y;
}

function handIn(doc: Doc, top: number) {
  const y = top + 10;
  tickBox(doc, MARGIN, y);
  doc.fillColor("#000").font(BOLD).fontSize(8).text("Reconstructed", MARGIN + 16, y + 1.5, { continued: true });
  doc.font(FONT).text(" - original sheet lost or damaged (OPR-038)", { lineBreak: false });
  doc.font(FONT).fontSize(8).text("Hand in at pull-in to operations management. ", MARGIN, y + 18, { continued: true });
  doc.font(BOLD).text("Do not fold through the code. ", { continued: true });
  doc.font(FONT).text("Entering on the kiosk does not replace handing this in.", { lineBreak: false });
}

function footer(doc: Doc, text: { page: string; link: string; printed: string }) {
  const y = PAGE.height - 50;
  doc.lineWidth(0.6).moveTo(MARGIN, y - 4).lineTo(RIGHT, y - 4).stroke();
  doc.fillColor("#000").font(FONT).fontSize(7).text(text.page, MARGIN, y, { lineBreak: false });
  doc.font(FONT).fontSize(7).text(text.printed, MARGIN, y, { width: RIGHT - MARGIN, align: "right", lineBreak: false });
  // The link on a line of its own: a console on a long hostname would run into the rest.
  doc.font(MONO).fontSize(6.5).text(text.link, MARGIN, y + 10, { width: RIGHT - MARGIN, lineBreak: false, ellipsis: true });
}

function blankBack(doc: Doc) {
  doc.addPage({ size: "LETTER", margin: 0 });
  doc.fillColor("#000").font(FONT).fontSize(9).text("This side intentionally blank", 0, PAGE.height / 2, { width: PAGE.width, align: "center", lineBreak: false });
}

/** One PDF: each sheet's pages in the order given, a blank back after each page when asked. */
export function renderCountSheets(input: CountSheetInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "LETTER",
    margin: 0,
    autoFirstPage: false,
    info: {
      Title: `Count Sheets ${dashedDate(input.serviceDate)}`,
      Author: "MVTA OnBoard",
      CreationDate: input.printedAt,
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const printed = `Printed ${printedLabel(input.printedAt)} from the Dispatch Log`;
  for (const sheet of input.sheets) {
    for (let page = 1; page <= sheet.pages; page++) {
      doc.addPage({ size: "LETTER", margin: 0 });
      const link = sheetLink(input.linkBase, input.serviceDate, sheet.block, page);
      const trips = sheet.trips.slice((page - 1) * TRIPS_PER_PAGE, page * TRIPS_PER_PAGE);
      cornerMarks(doc);
      header(doc, input.serviceDate, sheet, link);
      operatorSection(doc);
      howToCount(doc);
      let y = tripTable(doc, trips, (page - 1) * TRIPS_PER_PAGE + 1);
      if (page === sheet.pages) {
        y = unscheduledRows(doc, y);
        handIn(doc, y);
      } else {
        // Every page carries its own code, so every page carries the warning.
        doc.fillColor("#000").font(FONT).fontSize(8).text(`Continued on page ${page + 1}. `, MARGIN, y + 10, { continued: true });
        doc.font(BOLD).text("Do not fold through the code.", { lineBreak: false });
      }
      footer(doc, {
        page: `Page ${page} of ${sheet.pages} · pull-out order ${sheet.order} of ${input.stackSize}`,
        link: link.replace(/^https?:\/\//, ""),
        printed,
      });
      if (input.blankBacks) blankBack(doc);
    }
  }
  doc.end();
  return done;
}
