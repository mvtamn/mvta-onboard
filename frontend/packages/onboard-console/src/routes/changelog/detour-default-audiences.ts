import type { ChangelogEntry } from "../changelogEntry.js";

const entry: ChangelogEntry = {
  version: "1.5.255",
  date: "2026-09-18",
  sections: [
    {
      heading: "Added",
      items: [
        "Administration > Detour contractor notification takes a list of default audiences — the people every detour must reach when the detour's own record names nobody. A detour that arrives from the Avail feed names nobody, which is why they all read \"needs communication\" with nowhere to send.",
      ],
    },
    {
      heading: "Changed",
      items: [
        "A detour that names its own audiences keeps them; the defaults apply only where a detour names none. The contractor rule is unchanged.",
      ],
    },
  ],
};

export default entry;
