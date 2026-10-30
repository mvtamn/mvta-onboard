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

**All three questions we were holding are now closed:**

1. Month boundary — fixed, and confirmed independently from our own data.
2. `Include Outliers` — he confirms BI runs it True, which is what we send. This
   was our hypothesis for the denominator gap; it was never the cause.
3. Default thresholds when unspecified — moot, we send all seven explicitly.

**Nothing left with Avail is blocking.** The residual is a sub-0.11-point
rounding difference that needs no action, plus the date-format confirmation,
which is a belt-and-braces question rather than a suspected fault.

**What remains is entirely ours:** restating the Tier A acceptance standard, and
completing A0 — reconciling the weekly CSV against the canned monthly report.
Neither depends on Avail.
