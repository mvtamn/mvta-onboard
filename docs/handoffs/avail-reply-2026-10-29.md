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

**A second question, found since: the monthly feed sends two records for one
route/stop/day-of-week.** Not for September — for March 2026. The
*Monthly By Route/Stop/Day of Week* call for March returned **1,108 records
carrying only 1,081 distinct** route/stop/day-of-week combinations. Twenty-seven
combinations arrived twice, each time with different counts.

They are confined to four stops:

| Route | Stop | Stop name |
| --- | --- | --- |
| 425 (Orange LINK) | 30435 | Nicollet Blvd at Fairview Ridges Hosp. S |
| 442 | 30435 | Nicollet Blvd at Fairview Ridges Hosp. S |
| 497 | 31768 | Marschall Rd at 4th Av NE corner |
| 497 | 31780 | Marschall Rd at 4 Av NW corner |
| 497 | 31860 | Scott County Government Center at Atwood |

**We think we know what they are, and we would like you to confirm it.** The two
values appear to partition the month at a schedule change effective **Wednesday
18 March 2026**. Taking route 425 at stop 30435:

| Day | The two records | Sum | Occurrences before / from 18 Mar | Expected split |
| --- | --- | --- | --- | --- |
| Mon | 41 + 28 | 69 | 3 / 2 | 41.4 / 27.6 |
| Tue | 42 + 28 | 70 | 3 / 2 | 42.0 / 28.0 |
| Wed | 28 + 28 | 56 | 2 / 2 | 28.0 / 28.0 |
| Thu | 28 + 28 | 56 | 2 / 2 | 28.0 / 28.0 |
| Fri | 28 + 28 | 56 | 2 / 2 | 28.0 / 28.0 |

Mondays and Tuesdays are the only weekdays March 2026 has five of, and they are
the only ones that split unevenly — in the exact 3:2 ratio of how many fell
before and from the 18th. That holds for all 27 combinations. It reads as one
record per service pattern, surfacing in an aggregate that has no field to tell
them apart.

So, three things:

1. **Is that right** — was there a pattern or schedule change effective 18 March
   2026 affecting routes 425, 442 and 497 at those stops?
2. **Is one record per pattern the intended behaviour** of this operation, or is
   the intent one record per route/stop/day-of-week?
3. If it is intended, **is there a field that distinguishes them** that the
   operation does not currently return? The response shape we see carries
   `DayOfWeek`, `StopID`, `StopInternetName`, `RouteID`, `RouteReportLabel`, the
   five percentages, `Early`/`Ontime`/`Late`/`Missed`, `ActualDepartures` and
   `Total` — nothing identifying a pattern, direction or effective date. Your
   *Daily By Route/Stop/Hour* operation does return `Direction`, which is why we
   key that one differently.

For context on why we care rather than just handling it: our loader was keyed on
route/stop/day-of-week, so for three years the second record silently replaced
the first. March 2026 was short **855 departures** — 90.46% against a true
90.50%, so immaterial here, but it was invisible, and we only found it because
the figures were otherwise completely stable. We now add the pair together,
which reproduces the correct total. We would still rather key on a real
discriminator than infer one, hence question 3.

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
and the re-pull on 2026-10-31 took March to 67,330 departures / 90.50%, which is
the figure the fix predicted. We are asking Avail to confirm the cause and say
whether a discriminator field exists, so that we can key on it rather than infer
the sum. If the answer is "one record per pattern, by design, and there is no
such field," summing stays the right answer and nothing further is needed.

**The residual with Avail otherwise needs no action:** a sub-0.11-point rounding
difference, plus the date-format confirmation, which is belt-and-braces rather
than a suspected fault.

**What remains is entirely ours:** restating the Tier A acceptance standard, and
completing A0 — reconciling the weekly CSV against the canned monthly report.
Neither depends on Avail.
