# Draft reply to Avail (Charlie Flynn) — 29 Oct 2026

Subject: Re: OTP API vs BI — our exact pull requests

---

Charlie,

Thanks — and thank you for finding and fixing the month-boundary issue. That
turned out to explain the departure-count gap we raised, exactly.

**Our exact pull requests.** Both OTP operations, with the parameters we send
today:

```
https://avail360-api.myavail.cloud/OtpByRouteStopDayAgg/v1/MVTA/09-01-2026/2/5/10/60/0/1/1
https://avail360-api.myavail.cloud/OtpByRouteStopDayHour/v1/MVTA/09-01-2026/09-30-2026/2/5/10/60/0/1/1
```

So `2/5/10/60/0/1/1` — early 2, late 5, early outlier 10, late outlier 60,
show missed stops false, include outliers true, show detours true. Identical to
the BI defaults you listed.

**They were not identical until two days ago.** We had been sending
`1/5/15/30/0/1/1`. The early threshold of 1 minute was the significant one: it
counted a departure 1–2 minutes early as early, where MVTA's standard counts it
on time. The outlier values had been taken from the example in your API
specification during an earlier investigation and never aligned to MVTA's
configuration. We corrected all four on 27 October and re-pulled every month of
2026.

**With both fixes in, our figures and your BI report agree.** September 2026,
after your month-boundary correction and our parameter correction:

| Route | OnBoard (via API) | Your BI pull | Difference |
| --- | --- | --- | --- |
| 420 | 89.17 | 89.2 | 0.03 |
| 465 | 66.33 | 66.4 | 0.07 |
| 475 | 56.79 | 56.9 | 0.11 |
| 495 | 80.81 | 80.9 | 0.09 |
| **Agency** | **81.20** | **81.3** | **0.10** |

Route 465 now returns **4,045 departures**, matching your BI report's count
exactly — it was 4,271 before your fix. That resolves the "about 5.5% more
departures" you identified.

This matches your own finding of a sub-1% rounding difference. At our end the
largest per-route gap is 0.11 points and the agency gap is 0.10, which is well
inside what we need. We are not looking for anything further on that.

**A second question, found since: a mid-month stop rename splits the month.**
Not in September — in March 2026. The *Monthly By Route/Stop/Day of Week* call
for March returned **1,108 records carrying only 1,081 distinct**
route/stop/day-of-week combinations. Twenty-seven combinations arrived twice,
with different counts each time.

The two records differ in exactly one field: `StopInternetName`.

| Stop | Returned for Feb and Mar | Returned from Apr |
| --- | --- | --- |
| 30435 | Nicollet Blvd at Fairview Ridges Hosp. S | Nicollet Blvd at Fairview Ridges Hosp S |
| 31768 | Marschall Rd at 4th Av NE corner | Marschall Rd at 4th Ave NE Corner |
| 31780 | Marschall Rd at 4 Av NW corner | Marschall Rd at 4th Ave NW Corner |
| 31860 | Scott County Government Center at Atwood | Scott County Government Center SB |

February returns only the first spelling, April onward only the second, and
March returns both — as two records per route/stop/day-of-week, one per name.
The counts partition the month at the rename. Route 425 at stop 30435:

| Day | The two records | Sum | Occurrences before / from 18 Mar | 3:2 of the sum |
| --- | --- | --- | --- | --- |
| Mon | 41 + 28 | 69 | 3 / 2 | 41.4 / 27.6 |
| Tue | 42 + 28 | 70 | 3 / 2 | 42.0 / 28.0 |
| Wed | 28 + 28 | 56 | 2 / 2 | 28.0 / 28.0 |
| Thu | 28 + 28 | 56 | 2 / 2 | 28.0 / 28.0 |
| Fri | 28 + 28 | 56 | 2 / 2 | 28.0 / 28.0 |

Mondays and Tuesdays are the only weekdays March 2026 has five of, and they are
the only ones that split unevenly — in the exact ratio of how many fell before
and from Wednesday 18 March. That holds for all 27 combinations, which puts the
rename on or about 18 March.

So it reads as the aggregate grouping by the stop *record* rather than by
`StopID`, meaning a stop renamed mid-month has its month divided between its two
names. Three questions:

1. **Is that right** — does this operation group by the stop record, so that any
   mid-month stop rename splits that month into one record per name?
2. **Were those four stops renamed on or about 18 March 2026?** Three of the four
   changes are cosmetic ("Av" to "Ave", a dropped full stop, capitalisation),
   which is what makes us fairly confident this is a naming change rather than
   anything operational — but we would rather hear it than deduce it.
3. **Is there a stop-record identifier, or an effective date, that the operation
   could return?** `StopID` is the same on both records, so it cannot separate
   them, and the name is not something we want to key on — it would scatter one
   stop's month across two half-rows under two spellings. Something stable, or an
   effective-date field, would let us handle this properly. Your *Daily By
   Route/Stop/Hour* operation returns `Direction`, which is why we key that one
   differently and why it has never had this problem.

For context on why we are raising it rather than just handling it: our loader was
keyed on route/stop/day-of-week, so the second record silently replaced the
first. March 2026 was short **855 departures** — 90.46% against a true 90.50%,
immaterial in itself, but invisible, and we only found it because every other
figure had become stable. We now add the pair together, which reproduces the
correct total, and March re-pulled to 90.50%. But this will recur at the next
mid-month rename, and we would rather key on a real identifier than keep
inferring one.

**One small thing worth confirming.** Your examples use `2026-09-01`; we send
`09-01-2026` (MM-DD-YYYY), which is what your API specification's examples
showed us. Both appear to parse correctly — September requests return September
data — but every monthly call we make uses day `01`, which is ambiguous between
MM-DD and DD-MM. Could you confirm the API reads `09-01-2026` as 1 September
rather than 9 January? Given the issue you just fixed was date-range handling,
we would rather have it stated than inferred.

**Confirmation of your fix, from our side.** You verified it for September; it
held for every month. We re-pulled all ten service months of 2026, and the size
of each correction is explained entirely by which day of the week the following
month's 1st fell on — the surplus day:

- Weekday surplus (Mar, Apr, May, Jun, Aug, Sep): 3.6–4.0% of departures removed
- Weekend surplus (Jan and Feb, both Sundays; Jul, a Saturday): 1.6–1.7% removed

Nine months out of nine. Thought that might be useful to you as independent
confirmation the backend change behaved consistently across the full range.

Thanks again for running this down.

Tyre

---

## Notes for us, not for Charlie

**The three questions we were holding are closed; one new one is open (March duplicates, below):**

1. Month boundary — fixed, and confirmed independently from our own data.
2. `Include Outliers` — he confirms BI runs it True, which is what we send. This
   was our hypothesis for the denominator gap; it was never the cause.
3. Default thresholds when unspecified — moot, we send all seven explicitly.

**One new question is open, and it is not blocking either.** The March
duplicate-record behaviour is handled at our end as of 1.6.48 - we sum the pair,
and the re-pull took March to 67,330 departures / 90.50%, the figure the fix
predicted. The cause is established on our side and not in doubt: the pair
differs only in `StopInternetName`, February holds the old spelling and April
the new one. What we want from Avail is a stable stop-record identifier or an
effective date, so the loader can key on a discriminator instead of summing on
the assumption that two records on one key always partition rather than repeat.
If the answer is "by design, and there is no such field," summing stays correct
and nothing further is needed - but it will recur at the next mid-month rename.

**The residual with Avail otherwise needs no action:** a sub-0.11-point rounding
difference, plus the date-format confirmation, which is belt-and-braces rather
than a suspected fault.

**What remains is entirely ours:** restating the Tier A acceptance standard, and
completing A0 — reconciling the weekly CSV against the canned monthly report.
Neither depends on Avail.
