import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContractorPerformanceStandard, ManualMetricEntry } from "@mvta/shared";
import { MetricRow } from "./AssessmentModule.js";

// Average Miles Between Road Calls was typed as the finished quotient. The row
// asks for the miles and the road calls, does the division, and keeps both.

const roadCalls: ContractorPerformanceStandard = {
  id: "s1", code: "AVG_MILES_ROAD_CALLS", name: "Average Miles Between Road Calls", standard_type: "threshold",
  priority: "Medium", is_scored: true, unit_label: "miles", measurement_source: "structured_import", source_system: "Asset Works M5", assigned_to: "Maurice",
};
const conduct: ContractorPerformanceStandard = {
  id: "s2", code: "OPERATOR_CONDUCT", name: "Operator Conduct Complaints", standard_type: "threshold",
  priority: "High", is_scored: true, unit_label: "occurrences", measurement_source: "manual_entry",
};
const entry = (over: Partial<ManualMetricEntry>): ManualMetricEntry => ({
  id: "m1", standard_id: "s1", standard_code: "AVG_MILES_ROAD_CALLS", standard_name: roadCalls.name, contractor_id: "c", contractor_name: "C",
  service_month: "202608", metric_value: 13300, source_note: "M5 road call report", entered_by: "maurice", entered_at: "2026-09-02T14:00:00Z", ...over,
});

const view = (standard: ContractorPerformanceStandard, saved?: ManualMetricEntry) => {
  const onSave = vi.fn();
  render(<MetricRow item={{ standard, entry: saved }} busy={false} onSave={onSave} />);
  return { onSave };
};

describe("MetricRow for a ratio standard", () => {
  afterEach(cleanup);

  it("asks for miles and road calls, not a value", () => {
    view(roadCalls);
    expect(screen.getByLabelText(/miles operated/i)).toBeTruthy();
    expect(screen.getByLabelText(/chargeable road calls/i)).toBeTruthy();
    expect(screen.queryByLabelText(/Road Calls value$/)).toBeNull();
  });

  it("works the figure out as the parts are typed and saves all three", () => {
    const { onSave } = view(roadCalls);
    fireEvent.change(screen.getByLabelText(/miles operated/i), { target: { value: "412300" } });
    fireEvent.change(screen.getByLabelText(/chargeable road calls/i), { target: { value: "31" } });
    expect(screen.getByText("= 13,300 miles")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/source of record/i), { target: { value: "M5 road call report, August" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("s1", 13300, "M5 road call report, August", { numerator: 412300, denominator: 31 });
  });

  it("cannot save until both parts and the source are in", () => {
    view(roadCalls);
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(/miles operated/i), { target: { value: "412300" } });
    fireEvent.change(screen.getByLabelText(/source of record/i), { target: { value: "M5" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/chargeable road calls/i), { target: { value: "31" } });
    expect(save.disabled).toBe(false);
  });

  it("records the miles run when there were no road calls", () => {
    const { onSave } = view(roadCalls);
    fireEvent.change(screen.getByLabelText(/miles operated/i), { target: { value: "412300" } });
    fireEvent.change(screen.getByLabelText(/chargeable road calls/i), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText(/source of record/i), { target: { value: "M5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("s1", 412300, "M5", { numerator: 412300, denominator: 0 });
  });

  it("shows a saved figure with its working", () => {
    view(roadCalls, entry({ numerator: 412300, denominator: 31 }));
    expect(screen.getByText("13,300")).toBeTruthy();
    expect(screen.getByText("412,300 miles ÷ 31 road calls")).toBeTruthy();
  });

  it("says when a saved month had no road calls", () => {
    view(roadCalls, entry({ metric_value: 412300, numerator: 412300, denominator: 0 }));
    expect(screen.getByText("412,300 miles, no road calls")).toBeTruthy();
  });

  it("shows a figure saved before the parts were kept without inventing working", () => {
    view(roadCalls, entry({}));
    expect(screen.getByText("13,300")).toBeTruthy();
    expect(screen.queryByText(/÷/)).toBeNull();
  });

  it("opens a saved entry for change with its parts filled in", () => {
    view(roadCalls, entry({ numerator: 412300, denominator: 31 }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect((screen.getByLabelText(/miles operated/i) as HTMLInputElement).value).toBe("412300");
    expect((screen.getByLabelText(/chargeable road calls/i) as HTMLInputElement).value).toBe("31");
  });
});

describe("MetricRow for a figure typed whole", () => {
  afterEach(cleanup);

  it("still takes one value and sends no parts", () => {
    const { onSave } = view(conduct);
    expect(screen.queryByLabelText(/miles operated/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("Operator Conduct Complaints value"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText(/source of record/i), { target: { value: "Nexus" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("s2", 9, "Nexus");
  });
});
