import { describe, expect, it } from "vitest";
import { parseCsv, parseLegacyCsv, parseLegacyImportFile, parseLegacyJson } from "./legacyDetourImport.js";
import { detoursToCsv } from "./detourSearch.js";
import type { Detour } from "@mvta/shared";

describe("parseCsv", () => {
  it("keeps a quoted comma inside one cell", () => {
    expect(parseCsv('a,"b, c",d')).toEqual([["a", "b, c", "d"]]);
  });
  it("unescapes doubled quotes and keeps quoted line breaks", () => {
    expect(parseCsv('"say ""hi""","line 1\nline 2"')).toEqual([['say "hi"', "line 1\nline 2"]]);
  });
  it("handles a BOM, CRLF endings, and a trailing newline", () => {
    expect(parseCsv("﻿x,y\r\n1,2\r\n")).toEqual([["x", "y"], ["1", "2"]]);
  });
  it("drops blank lines", () => {
    expect(parseCsv("x,y\n\n1,2\n,\n")).toEqual([["x", "y"], ["1", "2"]]);
  });
});

describe("parseLegacyCsv", () => {
  it("maps columns by header name in any order and any casing", () => {
    const text = "Routes,Closure,Ref,Service Date\n\"460 SB, 465 SB\",\"5th St closed, Main to 3rd\",951,2025-06-02\n";
    const { rows, skipped_rows, unmapped_columns } = parseLegacyCsv(text);
    expect(rows).toEqual([expect.objectContaining({ reference: "951", closure: "5th St closed, Main to 3rd", service_date: "2025-06-02", routes: "460 SB, 465 SB" })]);
    expect(skipped_rows).toEqual([]);
    expect(unmapped_columns).toEqual([]);
  });

  it("skips rows without a closure and reports their sheet position", () => {
    const { rows, skipped_rows } = parseLegacyCsv("closure,routes\nA,1\n,2\nB,3\n");
    expect(rows.map((r) => r.closure)).toEqual(["A", "B"]);
    expect(skipped_rows).toEqual([2]);
  });

  it("preserves unrecognised columns on the row and names them", () => {
    const { rows, unmapped_columns } = parseLegacyCsv("closure,Approved by\nA,J. Smith\n");
    expect(rows[0]["Approved by"]).toBe("J. Smith");
    expect(unmapped_columns).toEqual(["Approved by"]);
  });

  it("refuses a file with no closure column", () => {
    expect(() => parseLegacyCsv("foo,bar\n1,2\n")).toThrow(/No closure column/);
  });

  it("round-trips the Detour Reports export without shifting cells", () => {
    const d = {
      id: "d1", number: "951", internal_number: "MVTA-DET-2026-0012", closure: 'Bridge "A", closed', start_date: "2026-09-01", end_date: null,
      is_monitor_only: false, riders_directed: null, email_sent: false, expired_email_sent: false, spare_emailed: false, source: "manual",
      external_detour_id: null, last_edited_manually: false, avail_last_seen_at: null, created_by: "ops", created_at: "2026-08-30T12:00:00.000Z",
      updated_by: null, updated_at: "2026-08-30T12:00:00.000Z", status: "active", segments: [{ id: "s1", detour_id: "d1", routes: "460 SB, 465 SB", directions: null, sort_order: 0 }],
    } as Detour;
    const { rows } = parseLegacyImportFile("mvta-detours-2026-09-04.csv", detoursToCsv([d]));
    expect(rows).toHaveLength(1);
    expect(rows[0].closure).toBe('Bridge "A", closed');
    expect(rows[0].reference).toBe("MVTA-DET-2026-0012");
    expect(rows[0].routes).toBe("460 SB, 465 SB");
    expect(rows[0].service_date).toBe("2026-09-01");
  });
});

describe("parseLegacyJson", () => {
  it("accepts an array or a rows object and skips entries without closure", () => {
    expect(parseLegacyJson('[{"closure":"A"},{"routes":"1"}]').rows.map((r) => r.closure)).toEqual(["A"]);
    const result = parseLegacyJson('{"rows":[{"closure":"B","routes":" 7 "}]}');
    expect(result.rows[0].routes).toBe("7");
    expect(result.skipped_rows).toEqual([]);
  });
  it("refuses other shapes", () => {
    expect(() => parseLegacyJson('{"closure":"A"}')).toThrow(/array/);
  });
});
