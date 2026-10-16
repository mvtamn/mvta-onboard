import type { CheckModule } from "./check";
import { evidence, round, tripsWord } from "./check";

const BUCKETS: { label: string; maxMinutes: number }[] = [
  { label: "Under 3 min", maxMinutes: 2 },
  { label: "3–5 min", maxMinutes: 5 },
  { label: "6–10 min", maxMinutes: 10 },
  { label: "11–20 min", maxMinutes: 20 },
  { label: "Over 20 min", maxMinutes: Infinity },
];

// tight_turnarounds counts one line at three minutes. The typical layover says
// more: on the 20260909 feed 442's median is 3 minutes and 447's is 1, which is
// where one late trip becomes the next one's start.
export const recoveryTime: CheckModule = {
  definition: {
    id: "recovery_time",
    label: "Typical recovery time",
    unit: "min",
    threshold: 5,
    comparison: "at_most",
    why: "The median layover before this route's trips. With a few minutes of recovery, any lateness on the previous trip carries into this one before it has a GPS reading of its own.",
    owner: "scheduling",
    fix: "Lengthen the layover before this route's trips so one late trip does not become the next one's start.",
  },
  evaluate(route) {
    if (route.linksInto.length === 0) return { value: null, evidence: [] };
    const minutes = route.linksInto.map((link) => link.layoverSeconds / 60).sort((a, b) => a - b);
    const median = minutes[Math.floor(minutes.length / 2)];
    const rows = BUCKETS.map((bucket, i) => {
      const floor = i === 0 ? -Infinity : BUCKETS[i - 1].maxMinutes;
      const inBucket = minutes.filter((m) => Math.round(m) > floor && Math.round(m) <= bucket.maxMinutes).length;
      return evidence(`${bucket.label}: ${tripsWord(inBucket)} (${Math.round((100 * inBucket) / minutes.length)}%)`, { count: inBucket });
    });
    return { value: round(median), evidence: rows };
  },
};
