import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.129",
  date: "2026-09-06",
  sections: [
    {
      heading: "Fixed",
      items: [
        "On-Demand Service Quality no longer shows zeros while its monitor is not connected, your sign-in has expired, or the page is still loading. The four summary tiles read — in those states, because no source has reported anything to count. A reconciliation that found no active service still reads 0.",
        "A feed-trust banner on Integrations & Data Health now shows how serious it is: amber when a feed is stale or reporting nothing, red when it is unavailable, green when it is current. Every state used to be the same blue.",
        "The Spare webhook receiver no longer refuses deliveries because on-demand operational zones are unconfigured. It skips the on-demand monitor update, accepts the delivery, and reports the configuration gap once a minute.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "On-demand monitoring can now be switched on through infrastructure configuration instead of a Portal setting that the next deployment removed. It remains off; nothing about On-Demand Service Quality changes yet.",
      ],
    },
  ],
};

export default entry;
