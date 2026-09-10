import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PeriodKpiAssessment } from "@mvta/shared";
import { ScoreTable } from "./AssessmentModule.js";

// The scorecard row is the only route to a standard's detail page, and it was
// a <tr onClick> with no role and no tabindex: reachable by mouse and by
// nothing else. A reviewer working by keyboard, or reading with a screen
// reader, could not open any standard.

const row = (overrides: Partial<PeriodKpiAssessment> = {}): PeriodKpiAssessment => ({
  id: "r1", period_id: "p", standard_id: "s1", code: "INITIAL_TRAINING",
  name: "Initial Operator Training Violations", standard_type: "occurrence", priority: "Low",
  metric_display: "0 occurrences", tier_label: "meets", occurrence_count: 0, proposed_amount: 0,
  final_amount: null, manager_action: "pending", manager_reason: null, data_completeness_pct: 100,
  ...overrides,
});

const view = (props: { rows?: PeriodKpiAssessment[]; busy?: boolean } = {}) => {
  const rows = props.rows ?? [row()];
  const onDetail = vi.fn();
  render(<ScoreTable
    rows={rows}
    groups={[{ key: "staffing", label: "Staffing & Training", description: null, items: rows }]}
    totals={{ proposed: 0, final: 0, occurrences: 0, pending: 1, caps: 0 }}
    display={new Map()}
    status="in_review"
    tiers={[]}
    busy={props.busy ?? false}
    onDetail={onDetail}
    onEnterFigure={vi.fn()}
  />);
  return { onDetail };
};

describe("ScoreTable drill-in", () => {
  afterEach(cleanup);

  it("offers the standard as a button, not a bare clickable row", () => {
    view();
    // A real button is focusable and reachable in tab order for free; a <tr>
    // with an onClick is neither.
    expect(screen.getByRole("button", { name: "Initial Operator Training Violations" })).toBeInTheDocument();
  });

  it("opens the detail page from the keyboard", () => {
    const { onDetail } = view();
    const open = screen.getByRole("button", { name: "Initial Operator Training Violations" });
    open.focus();
    expect(open).toHaveFocus();
    // Enter on a focused button is a click; this is the path that did not exist.
    fireEvent.click(open);
    expect(onDetail).toHaveBeenCalledTimes(1);
    expect(onDetail.mock.calls[0][0].code).toBe("INITIAL_TRAINING");
  });

  it("opens it once, not twice, when the button inside the row is clicked", () => {
    // The row keeps its own onClick so the whole row stays a mouse target.
    // Without stopPropagation both handlers fire for one click.
    const { onDetail } = view();
    fireEvent.click(screen.getByRole("button", { name: "Initial Operator Training Violations" }));
    expect(onDetail).toHaveBeenCalledTimes(1);
  });

  it("still opens from anywhere else in the row, for the mouse", () => {
    const { onDetail } = view();
    fireEvent.click(screen.getByText("0 occurrences"));
    expect(onDetail).toHaveBeenCalledTimes(1);
  });

  it("is not offered while the month is busy", () => {
    const { onDetail } = view({ busy: true });
    const open = screen.getByRole("button", { name: "Initial Operator Training Violations" });
    expect(open).toBeDisabled();
    fireEvent.click(open);
    // The row's own handler is gated on busy too, so nothing opens.
    fireEvent.click(screen.getByText("0 occurrences"));
    expect(onDetail).not.toHaveBeenCalled();
  });

  it("keeps Enter figure reachable and separate from the drill-in", () => {
    const onEnterFigure = vi.fn();
    const onDetail = vi.fn();
    const rows = [row({ assessment_outcome: "not_assessable" })];
    render(<ScoreTable
      rows={rows}
      groups={[{ key: "staffing", label: "Staffing & Training", description: null, items: rows }]}
      totals={{ proposed: 0, final: 0, occurrences: 0, pending: 1, caps: 0 }}
      display={new Map()} status="in_review" tiers={[]} busy={false}
      onDetail={onDetail} onEnterFigure={onEnterFigure}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Enter figure" }));
    expect(onEnterFigure).toHaveBeenCalledTimes(1);
    expect(onDetail).not.toHaveBeenCalled();
  });

  it("names every scored standard as its own button", () => {
    const rows = [row(), row({ id: "r2", standard_id: "s2", code: "PIVOT_MISUSE", name: "Pivot Operator Misuse" })];
    view({ rows });
    const table = screen.getByRole("table");
    for (const name of ["Initial Operator Training Violations", "Pivot Operator Misuse"]) {
      expect(within(table).getByRole("button", { name })).toBeInTheDocument();
    }
  });
});
