import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Subscribers } from "./Subscribers.js";

const getSubscribersSummary = vi.fn();
vi.mock("../config.js", () => ({ api: { getSubscribersSummary: (...args: unknown[]) => getSubscribersSummary(...args) } }));

afterEach(() => {
  cleanup();
  getSubscribersSummary.mockReset();
});

describe("Subscribers", () => {
  it("renders zero cards when the table is empty and the API sends nulls for the SUM columns", async () => {
    // What SQL Server actually returns for SUM(CASE ...) over zero rows,
    // before the API learned to coalesce. The page must survive it either way.
    getSubscribersSummary.mockResolvedValue({
      summary: { total: 0, sms_confirmed: null, email_confirmed: null, pending: null, opted_out: null },
      recent: [],
    });
    render(<Subscribers />);
    await waitFor(() => expect(screen.getByText("TOTAL")).toBeInTheDocument());
    expect(screen.getAllByText("0")).toHaveLength(4);
    expect(screen.getByText("No subscribers yet.")).toBeInTheDocument();
  });

  it("formats real counts", async () => {
    getSubscribersSummary.mockResolvedValue({
      summary: { total: 1234, sms_confirmed: 1000, email_confirmed: 200, pending: 34, opted_out: 0 },
    });
    render(<Subscribers />);
    await waitFor(() => expect(screen.getByText("1,234")).toBeInTheDocument());
    expect(screen.getByText("Recent sign-up detail is visible to Operations Administrators only.")).toBeInTheDocument();
  });
});
