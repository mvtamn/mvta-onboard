# Pull Operational zones from Spare and version them by geometry

**Status:** accepted

Operational zone geometry comes only from the GTFS-Flex feed Spare generates for
MVTA, pulled daily from Spare's generator. The manual archive upload that stood
in while no URL was known is removed rather than kept as a fallback: zones change
once or twice a year, a failed pull leaves the active Zone version in force, and
a second way in would be a second place zone geometry could come from. Which of
Spare's published locations are Operational zones stays MVTA's choice, an
explicit list; a listed zone missing from the feed fails the import, and a
location Spare publishes that is not on the list is ignored but shown to the
person who activates versions, so a new service area is not left unmonitored
unnoticed.

A Zone version is identified by a hash of the monitored zones' identities, names
and geometry - not by the archive's bytes or its `feed_version`. Spare stamps the
export time into `feed_info.txt` and the archive on every call (confirmed
2026-09-17: two fetches 75 seconds apart differed in both while
`locations.geojson` was byte-identical), so identifying a version by the archive
would create a new version on every daily pull.

A changed Zone version still waits for a person to activate it, even though
Spare is the authority. Activation changes how requests are assigned to zones and
how service-quality results are split from then on, and a human check is the
guard against a broken or partial generation. Only the first version ever
imported is in force at once.

## Considered Options

- **Keep the upload as a fallback.** Rejected: see above.
- **Hash the raw archive, or `locations.geojson`.** The archive churns daily; the
  raw geojson would also create a waiting version when only the reference
  boundary or an unmonitored location changed.
- **Activate Spare's changes automatically, optionally behind a sanity check.**
  Rejected for now; revisit if activations become routine rather than a
  once-or-twice-a-year event.
