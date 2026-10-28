import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.6.43",
  date: "2026-10-27",
  sections: [
    {
      heading: "Added",
      items: [
        "The OTP measurement standard — what counts as early, late and an outlier — is now declared on the OTP Compliance administration page, with the date it took effect and where it came from, instead of living in OnBoard's code. These are MVTA's own Avail settings, and Avail can change them on their side, so there is now a record of what OnBoard was told and by whom.",
        "Every OTP figure OnBoard stores is stamped with the standard it was measured under, so it is possible to say which stored figures are comparable with each other.",
        "The page lists any service month whose figures were measured under a different standard, with a button to ask Avail for that month again. Nothing is re-measured automatically: declaring a standard changes what is polled from then on and leaves existing months alone until somebody chooses to re-pull one.",
        "A declared standard appears in the OTP Audit Stream alongside stop and weather-day decisions, since it is the one change that moves a month's figure without anybody deciding anything about a stop or a date.",
      ],
    },
    {
      heading: "Note",
      items: [
        "Months stored before this release have no stamp, and are shown as \"not recorded\" rather than assumed to be current — the declaration history says what was in force when they were stored.",
        "The three months behind the OTP compliance validation (May, June and August 2026) were all measured under the standard corrected in 1.6.39, so they appear in the re-pull list and should be re-pulled before being compared with the manual figure.",
      ],
    },
  ],
};

export default entry;
