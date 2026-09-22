// Detour requests waiting on OCC, for the Dashboard queue and the nav count.
//
// Submitting an intake notifies nobody, so the only way OCC learned one had
// arrived was to open the Intake page. This is the read behind both places that
// now say so without being opened.
import { useEffect, useState } from "react";
import type { DetourIntake } from "@mvta/shared";
import { api } from "../config.js";
import { pendingIntakes } from "../lib/intakeQueue.js";

export function usePendingIntake(): { intake: DetourIntake[] | null; count: number } {
  const [intake, setIntake] = useState<DetourIntake[] | null>(null);
  useEffect(() => {
    let live = true;
    // A failure leaves this null rather than zero: "none waiting" and "could not
    // ask" are different, and a badge that shows 0 when the API is down would be
    // a lie in the direction that hides work.
    void api.getDetourIntake()
      .then((result) => { if (live) setIntake(result.intake); })
      .catch(() => { if (live) setIntake(null); });
    return () => { live = false; };
  }, []);
  return { intake, count: pendingIntakes(intake).length };
}
