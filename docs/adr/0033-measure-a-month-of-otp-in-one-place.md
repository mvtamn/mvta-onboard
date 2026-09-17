# Measure a Month of OTP in One Place

**Status:** accepted

Fixed-route on-time performance for a service month is measured by one module
(`functions-restapi/src/lib/otpMonth`). It returns the raw, excluded and
assessable figures — agency-wide and per route — together with the target the
month is judged against. The assessment resolver, `GET /otp-monthly`, the trend
endpoint, `vw_OtpMonthlyRouteStop` and the console all read that measurement;
none of them re-decides what counts. The rule itself — fixed-route service
only, minus approved stop exclusions — exists once as a SQL fragment with a
TypeScript twin, and the reporting view is built from that same fragment.

Five places used to answer the question and they disagreed. The resolver
filtered to fixed route and removed approved stop exclusions; the view repeated
that rule as a column; `/otp-monthly` and the trend did neither; and the
browser recomputed its own "official" percentage from rows it had flagged
itself. The Dashboard card labelled "Routes below target · Official departure
OTP" counted routes from the raw rollup, and Route Summary compared them
against a hardcoded 85% while the Dashboard used the target the API sent. Two
screens could therefore show a contractor two different official figures for
the same month.

**The target comes from the month's frozen rule set.** Where a month has a
single Assessment Period, its target is that period's snapshotted standard and
bands (ADR 0006); otherwise the current catalog answers, and the measurement
says which of the two it used. Looking the target up by effective date, as the
handler did, let a band edited later restate a month already finalized.

**Weather-day exclusions are recorded and deliberately not applied.** Avail's
monthly feed is aggregated by day of week, not by date, so a single weather
date cannot be removed from it — the nearest thing available would remove every
Monday in the month. `OtpDateExclusions` rows are therefore counted and
reported, and the console says plainly that they are not applied. Applying them
needs date-level official data from Avail; until that exists, no figure claims
to include them.

**Consequences:** a new reader of OTP calls the module rather than writing its
own SQL, and a change to what counts is made in one fragment, with the view
regenerated from it. The console no longer computes a percentage; it displays
one. Because the fixed-route filter is now applied everywhere rather than only
in the assessment, a route classified as special-event or on-demand disappears
from the Dashboard and Route Summary figures, where it used to be counted.
