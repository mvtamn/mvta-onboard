import { describe, expect, it } from "vitest";
import type { DetourIntake } from "@mvta/shared";
import { isWaitingOnOcc, pendingIntakes, waitingHours, waitingLabel } from "./intakeQueue.js";

const intake = (status: string, created_at = "2026-09-18T09:00:00Z") =>
  ({ id: status, status, created_at } as unknown as DetourIntake);

describe("what is waiting on OCC", () => {
  it("counts an intake awaiting review", () => {
    expect(isWaitingOnOcc(intake("pending_review"))).toBe(true);
  });

  it("does not count one returned for information — that is the submitter's move", () => {
    expect(isWaitingOnOcc(intake("needs_information"))).toBe(false);
  });

  it("does not count one already settled, or still a draft", () => {
    for (const status of ["accepted", "rejected", "duplicate", "withdrawn", "draft"]) {
      expect(isWaitingOnOcc(intake(status))).toBe(false);
    }
  });

  it("filters a list, and tolerates not having one yet", () => {
    expect(pendingIntakes([intake("pending_review"), intake("accepted")]).map((i) => i.status))
      .toEqual(["pending_review"]);
    expect(pendingIntakes(null)).toEqual([]);
  });
});

describe("how long it has been waiting", () => {
  const now = new Date("2026-09-18T12:00:00Z").getTime();

  it("counts whole hours since it arrived", () => {
    expect(waitingHours(intake("pending_review", "2026-09-18T09:00:00Z"), now)).toBe(3);
    expect(waitingHours(intake("pending_review", "2026-09-18T11:59:00Z"), now)).toBe(0);
  });

  it("never reports a negative wait for a clock that disagrees", () => {
    expect(waitingHours(intake("pending_review", "2026-09-18T13:00:00Z"), now)).toBe(0);
  });

  it("treats an unreadable date as no wait rather than NaN", () => {
    expect(waitingHours(intake("pending_review", "not a date"), now)).toBe(0);
  });

  it("reads in hours, then in days", () => {
    expect(waitingLabel(0)).toBe("Just arrived");
    expect(waitingLabel(3)).toBe("Waiting 3h");
    expect(waitingLabel(24)).toBe("Waiting 1 day");
    expect(waitingLabel(75)).toBe("Waiting 3 days");
  });
});
