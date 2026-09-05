import { describe, expect, it } from "vitest";
import type { Detour } from "@mvta/shared";
import { detoursToCsv, filterDetours, historicalRowMatchesSearch, EMPTY_FILTERS } from "./detourSearch.js";
import type { DetourHistoricalImportRow } from "@mvta/shared";
import { communicationStatusLabel, fulfillmentPathLabel, readinessLabel, workflowLabel } from "./detourLabels.js";

function detour(overrides: Partial<Detour> = {}): Detour {
  return {
    id: "d1", number: "951", internal_number: "MVTA-DET-2026-0012", closure: "5th St closed, Main to 3rd",
    start_date: "2026-09-01", end_date: "2026-09-05", is_monitor_only: false, riders_directed: null,
    email_sent: true, expired_email_sent: false, spare_emailed: false, source: "manual", external_detour_id: null,
    last_edited_manually: false, avail_last_seen_at: null, created_by: "ops@mvta", created_at: "2026-08-30T12:00:00.000Z",
    updated_by: null, updated_at: "2026-08-30T12:00:00.000Z", status: "active",
    fulfillment_mode: "avail", lifecycle_state: "awaiting_fulfillment", workflow_owner: "occ@mvta",
    readiness: "ready_for_avail_entry", communication_status: "draft", review_status: "needs_review", review_reason: "Dates changed",
    closure_reason: null, segments: [{ id: "s1", detour_id: "d1", routes: "460 SB", directions: null, sort_order: 0 }],
    ...overrides,
  } as Detour;
}

// Parses one CSV line of fully-quoted cells back into an array.
function cells(line: string): string[] {
  return line.split(/","/).map((cell) => cell.replace(/^"|"$/g, "").replace(/""/g, '"'));
}

describe("detoursToCsv", () => {
  it("emits the same number of cells in every row as in the header", () => {
    const [header, row] = detoursToCsv([detour()]).split("\r\n");
    expect(cells(row)).toHaveLength(cells(header).length);
  });

  it("carries the workflow columns the Reports table shows, using the same labels", () => {
    const d = detour();
    const [header, row] = detoursToCsv([d]).split("\r\n").map(cells);
    const byHeader = Object.fromEntries(header.map((h, i) => [h, row[i]]));
    expect(byHeader["Path"]).toBe(fulfillmentPathLabel(d));
    expect(byHeader["Readiness"]).toBe(readinessLabel(d));
    expect(byHeader["Readiness"]).toContain("Needs OCC re-review");
    expect(byHeader["Next owner"]).toBe("occ@mvta");
    expect(byHeader["Communications"]).toBe(communicationStatusLabel(d));
    expect(byHeader["Workflow"]).toBe(workflowLabel(d));
    expect(byHeader["Re-review reason"]).toBe("Dates changed");
    expect(byHeader["Conflicts"]).toBe("");
    expect(byHeader["Routes"]).toBe("460 SB");
  });

  it("quotes commas and doubles embedded quotes so Excel keeps the closure in one cell", () => {
    const csv = detoursToCsv([detour({ closure: 'Bridge "A", closed' })]);
    expect(csv).toContain('"Bridge ""A"", closed"');
  });

  it("carries closure reason and Avail linkage when present", () => {
    const d = detour({ lifecycle_state: "closed", readiness: "closed", closure_reason: "Work finished early", avail_entry_result: "entered", external_detour_id: "AV-77", avail_last_seen_at: "2026-09-02T10:00:00.000Z" });
    const [header, row] = detoursToCsv([d]).split("\r\n").map(cells);
    const byHeader = Object.fromEntries(header.map((h, i) => [h, row[i]]));
    expect(byHeader["Closure reason"]).toBe("Work finished early");
    expect(byHeader["Avail entry"]).toBe("entered");
    expect(byHeader["Avail detour ID"]).toBe("AV-77");
    expect(byHeader["Avail last seen"]).toBe("2026-09-02T10:00:00.000Z");
  });
});

describe("filterDetours", () => {
  it("returns everything with empty filters", () => {
    expect(filterDetours([detour(), detour({ id: "d2" })], EMPTY_FILTERS)).toHaveLength(2);
  });

  it("drops undated rows once a start range is set", () => {
    const rows = [detour(), detour({ id: "d2", start_date: null })];
    expect(filterDetours(rows, { ...EMPTY_FILTERS, startFrom: "2026-01-01" }).map((d) => d.id)).toEqual(["d1"]);
  });
});

describe("historicalRowMatchesSearch", () => {
  const row: DetourHistoricalImportRow = {
    id: "h1", import_batch_id: "b1", source_file: "tracker-2025.csv", source_row_number: 3,
    historical_reference: "2025-014", closure: "Cedar Ave bridge closed", service_date: "2025-06-02", routes: "440, 442",
    communication_audience: "Operators", communication_channel: "email", communication_recipients: "ops list", communication_content: "Use Nicollet",
    communicated_at: null, imported_by: "compliance@mvta", imported_at: "2026-09-01T00:00:00.000Z",
  };
  it("matches every term across the legacy fields", () => {
    expect(historicalRowMatchesSearch(row, "cedar 442")).toBe(true);
    expect(historicalRowMatchesSearch(row, "nicollet")).toBe(true);
    expect(historicalRowMatchesSearch(row, "cedar 460")).toBe(false);
  });
  it("matches everything on an empty search", () => {
    expect(historicalRowMatchesSearch(row, "  ")).toBe(true);
  });
});

describe("conflict columns", () => {
  it("labels unresolved and overridden conflicts and flags readiness", () => {
    const conflicts = [{ kind: "detour" as const, id: "x", label: "MVTA-DET-2026-0003", status: "fulfilled", start_date: null, end_date: null, reasons: ["routes" as const], shared: ["460"] }];
    const [header, unresolved] = detoursToCsv([detour({ conflicts, conflict_status: "unresolved" })]).split("\r\n").map(cells);
    const col = header.indexOf("Conflicts");
    expect(unresolved[col]).toBe("Unresolved: MVTA-DET-2026-0003");
    expect(unresolved[header.indexOf("Readiness")]).toContain("Conflict needs override");
    const [, overridden] = detoursToCsv([detour({ conflicts, conflict_status: "overridden", conflict_override_reason: "Different stops" })]).split("\r\n").map(cells);
    expect(overridden[col]).toBe("Overridden (Different stops): MVTA-DET-2026-0003");
  });
});
