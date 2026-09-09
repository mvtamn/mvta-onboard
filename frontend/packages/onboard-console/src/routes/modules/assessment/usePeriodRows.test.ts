import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PeriodKpiAssessment } from "@mvta/shared";
import { usePeriodRows } from "./usePeriodRows.js";

// Two responses in flight for two different periods, resolved out of order:
// the rows on screen must belong to the period that is selected now, never to
// the one that answered last.
function row(id: string): PeriodKpiAssessment {
  return { id, period_id: "p", standard_id: "s", code: "OTP", name: "OTP", standard_type: "threshold", priority: "High", metric_display: "79%", tier_label: "tier1", occurrence_count: 0, proposed_amount: 1500, final_amount: null, manager_action: "pending", manager_reason: null, data_completeness_pct: 100 };
}

describe("usePeriodRows", () => {
  it("keeps the rows of the currently selected period when an older request answers later", async () => {
    const pending = new Map<string, (rows: PeriodKpiAssessment[]) => void>();
    const load = vi.fn((periodId: string) => new Promise<{ assessments: PeriodKpiAssessment[] }>(resolve => { pending.set(periodId, rows => resolve({ assessments: rows })); }));
    const { result, rerender } = renderHook(({ selected, refresh }) => usePeriodRows(load, selected, refresh), { initialProps: { selected: "july", refresh: 0 } });
    rerender({ selected: "august", refresh: 0 });
    await waitFor(() => expect(pending.has("august")).toBe(true));
    await act(async () => { pending.get("august")!([row("aug-otp")]); });
    await act(async () => { pending.get("july")!([row("jul-otp")]); });
    expect(result.current.rows.map(r => r.id)).toEqual(["aug-otp"]);
  });

  it("resets the KPI selection when the period changes, and picks the first row of the new one", async () => {
    const load = vi.fn((periodId: string) => Promise.resolve({ assessments: [row(`${periodId}-otp`)] }));
    const { result, rerender } = renderHook(({ selected, refresh }) => usePeriodRows(load, selected, refresh), { initialProps: { selected: "july", refresh: 0 } });
    await waitFor(() => expect(result.current.detailId).toBe("july-otp"));
    rerender({ selected: "august", refresh: 0 });
    await waitFor(() => expect(result.current.detailId).toBe("august-otp"));
  });

  it("reloads the same period when the refresh key changes", async () => {
    const load = vi.fn((periodId: string) => Promise.resolve({ assessments: [row(`${periodId}-otp`)] }));
    const { rerender } = renderHook(({ selected, refresh }) => usePeriodRows(load, selected, refresh), { initialProps: { selected: "july", refresh: 0 } });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    rerender({ selected: "july", refresh: 1 });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("clears rows when nothing is selected", async () => {
    const load = vi.fn((periodId: string) => Promise.resolve({ assessments: [row(`${periodId}-otp`)] }));
    const { result, rerender } = renderHook(({ selected, refresh }) => usePeriodRows(load, selected, refresh), { initialProps: { selected: "july", refresh: 0 } });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    rerender({ selected: "", refresh: 0 });
    await waitFor(() => expect(result.current.rows).toHaveLength(0));
  });
});
