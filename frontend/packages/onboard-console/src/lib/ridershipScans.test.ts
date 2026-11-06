import { describe, expect, it } from "vitest";
import type { RidershipScanPage, RidershipScanUpload } from "@mvta/shared";
import { scanPageNote, scanUploadSummary } from "./ridershipScans.js";

const page = (over: Partial<RidershipScanPage>): RidershipScanPage => ({
  page_id: "p", page_number: 1, state: "matched", reason: null, service_date: "20261212", block: "024", sheet_page: 1,
  identified_by: "qr", straightened: true, printed_at: null, date_flag: false, processed_at: null, assigned_by: null, ...over,
});

describe("scan words", () => {
  it("says how a page was identified, or why it was not", () => {
    expect(scanPageNote(page({}))).toBe("Read from the QR code.");
    expect(scanPageNote(page({ state: "duplicate" }))).toBe("Read from the QR code; the sheet was already scanned.");
    expect(scanPageNote(page({ identified_by: "person", assigned_by: "desk@example.test" }))).toBe("Typed by desk@example.test.");
    expect(scanPageNote(page({ state: "unreadable", reason: "not_identified", block: null, service_date: null, identified_by: null }))).toBe("The QR code could not be read.");
  });

  it("sums up an upload by outcome", () => {
    const upload: RidershipScanUpload = {
      upload_id: "u", garage: "Sample", file_name: "scan.pdf", status: "done", status_detail: null, page_count: 4, created_at: "", created_by: "",
      pages: [page({}), page({ state: "blank" }), page({ state: "unreadable" }), page({ state: "matched" })],
    };
    expect(scanUploadSummary(upload)).toBe("4 pages · 2 recognised · 1 blank · 1 needs you");
    expect(scanUploadSummary({ ...upload, status: "queued", pages: [] })).toBe("Waiting to be read");
  });
});
