import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.196",
  date: "2026-09-12",
  sections: [
    {
      heading: "Added",
      items: [
        "Operational zone geometry can be uploaded from the console. Service Standards now carries a Zone geometry section: export the GTFS-Flex feed from Spare and upload the .zip, and the zones it carries are imported and — when nothing is active yet — put straight into force. Until now the only way in was a command run inside the server, which nobody had ever done, so On-Demand pickups have never resolved against a boundary. The section says plainly when no version is active, names the feed version and zones an upload brought in, and explains why an archive was refused rather than reporting a generic failure. Activating a different version stays a separate, deliberate step, and a version carrying no zones cannot be activated at all.",
      ],
    },
    {
      heading: "Fixed",
      items: [
        "Turning On-Demand monitoring on without naming its services no longer reads every service. The hourly reconciliation treated an empty service list as \"no filter\", so the single setting that switches monitoring on would also have pulled in services that are not MVTA Connect. It now declines to run and records the misconfiguration against feed health, where it is visible, instead of appearing to succeed over the wrong population.",
      ],
    },
  ],
};

export default entry;
