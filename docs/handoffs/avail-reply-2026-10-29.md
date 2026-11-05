# Draft reply to Avail (Charlie Flynn)

Drafted 29 Oct 2026, revised 1 Nov 2026. **Not sent.** Tyre sends it.

This file has two parts and they do not mix:

- **Part 1** is the message. Everything between the SEND and END markers is for
  Charlie, and nothing else in this file is. Paste from marker to marker.
- **Part 2** is MVTA's own notes. **It does not go to Avail**, in whole or in
  part. It records what we decided not to ask and why, and the three follow-ups
  that are ours.

**One question is open with Avail**: a stable stop-record identifier on the
monthly operation. It is in Part 1, it states what a usable answer looks like,
and it is **not blocking** — the compliance figure is correct today and
reconciles with Avail's BI report.

The date format was the second question until 1 Nov, when it turned out the
reconciliation already proves it. It is **not asked** — see Part 2, "The date
format: settled, not asked".

---
---

# PART 1 — THE MESSAGE. SEND FROM HERE.

Subject: Re: OTP API vs BI — reconciled, with one thing left to ask

Charlie,

Thanks — and thank you for finding and fixing the month-boundary issue. That
turned out to explain the departure-count gap we raised, exactly.

## Where we landed

**Our exact pull requests.** Both OTP operations, with the parameters we send
today:

```
https://avail360-api.myavail.cloud/OtpByRouteStopDayAgg/v1/MVTA/09-01-2026/2/5/10/60/0/1/1
https://avail360-api.myavail.cloud/OtpByRouteStopDayHour/v1/MVTA/09-01-2026/09-30-2026/2/5/10/60/0/1/1
```

So `2/5/10/60/0/1/1` — early 2, late 5, early outlier 10, late outlier 60, show
missed stops false, include outliers true, show detours true. Identical to the
BI defaults you listed.

**They were not identical until 27 October.** We had been sending
`1/5/15/30/0/1/1`. The early threshold of 1 minute was the significant one: it
counted a departure 1–2 minutes early as early, where MVTA's standard counts it
on time. The outlier values had been taken from the example in your API
specification during an earlier investigation and never aligned to MVTA's
configuration. We corrected all four and re-pulled every month of 2026.

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
largest per-route gap is 0.11 points and the agency gap is 0.10, well inside
what we need. **We are not looking for anything further on that.**

**Confirmation of your fix, from our side.** You verified it for September; it
held for every month. We re-pulled all ten service months of 2026, and the size
of each correction is explained entirely by which day of the week the following
month's 1st fell on — the surplus day that had been included:

- Weekday surplus (Mar, Apr, May, Jun, Aug, Sep): 3.6–4.0% of departures removed
- Weekend surplus (Jan and Feb, both Sundays; Jul, a Saturday): 1.6–1.7% removed

Nine completed months out of nine, October still being in progress. Offered as
independent confirmation that the backend change behaved consistently across the
full range.

## One thing left, and it is not urgent

### Can the monthly operation return a stable stop identifier, or an effective date?

This is about the **Monthly By Route/Stop/Day of Week** operation
(`OtpByRouteStopDayAgg`). It is not blocking us — our stored figures are correct
today — but it will recur, and we would rather key on something real than keep
inferring it.

**The behaviour.** `OtpByRouteStopDayAgg` does not return exactly one record per
(service month, route, stop, day of week). For March 2026 it returned **1,108
records carrying 1,081 distinct** route/stop/day-of-week combinations:
**27 combinations arrived twice**, with different counts each time.

The two records in each pair differ in exactly one field that is not itself a
measurement: **`StopInternetName`**. We logged every field that differed across
all 27 pairs, and the complete list is `StopInternetName` plus the counts and
percentages themselves (`Total`, `ActualDepartures`, `Ontime`, `Early`, `Late`,
`NotOnTime`, `LateOutlier` and their `Percent…` equivalents). `StopID`,
`RouteID` and `DayOfWeek` are identical on both records.

Four stops are involved, and each returns a different spelling before and after:

| Stop | Returned for Feb, and in the first March record | Returned from Apr, and in the second |
| --- | --- | --- |
| 30435 | Nicollet Blvd at Fairview Ridges Hosp. S | Nicollet Blvd at Fairview Ridges Hosp S |
| 31768 | Marschall Rd at 4th Av NE corner | Marschall Rd at 4th Ave NE Corner |
| 31780 | Marschall Rd at 4 Av NW corner | Marschall Rd at 4th Ave NW Corner |
| 31860 | Scott County Government Center at Atwood | Scott County Government Center SB |

February returns only the first spelling, April onward only the second, and
March returns both — as two records per route/stop/day-of-week, one per name.

**The pair partitions the month, and it partitions it at 16 March.** The counts
divide in proportion to how many of each weekday fell before and from a single
date. Route 425 at stop 30435:

| Day | Record 1 (old name) | Record 2 (new name) | Occurrences 1–15 Mar / 16–31 Mar | Per-occurrence |
| --- | --- | --- | --- | --- |
| Mon | 28 | 41 | 2 / 3 | 14.0 vs 13.7 |
| Tue | 28 | 42 | 2 / 3 | 14.0 vs 14.0 |
| Wed | 28 | 28 | 2 / 2 | 14.0 vs 14.0 |
| Thu | 28 | 28 | 2 / 2 | 14.0 vs 14.0 |
| Fri | 28 | 28 | 2 / 2 | 14.0 vs 14.0 |

March 2026 has five Mondays and five Tuesdays and four of every other weekday,
which is why only those two days split unevenly. The weekend records pin the
date: route 442 at the same stop returned **39 and 24 Sunday departures**, and
March 2026 has five Sundays — 3 before and 2 from the 16th (1, 8, 15 against 22,
29), so Sunday the 15th sits with the old name and Monday the 16th with the new.

We tested every candidate date in March against all 27 pairs. **The 16th is the
only one consistent with all 27**; the 15th fails one and the 17th fails five.

**So our reading is:** the aggregate groups by the stop *record* rather than by
`StopID`, a stop renamed mid-month has its month divided between its two names,
and these four stops were renamed effective Monday 16 March 2026. We are
reasonably confident this is a naming change and nothing operational — three of
the four changes are cosmetic ("Av" to "Ave", a dropped full stop,
capitalisation) — but we are deducing it, which is why we are asking.

**What would settle it.** Any one of these, in order of usefulness to us:

1. **A stable stop-record identifier** on the monthly record — something that
   differs between the two records and does not change when the name does.
2. **An effective-date or period field** on the record, so we can see which part
   of the month each one covers.
3. **Confirmation that the behaviour is by design and that neither exists.** That
   is a perfectly workable answer; it tells us our handling is right and we stop
   waiting for a field.

Plus, if you can look it up: **were those four stops renamed effective Monday 16
March 2026?** A yes would confirm the whole reading.

`StopInternetName` is the one thing we do not want to key on: it would scatter a
single stop's month across two half-records under two spellings of one stop, and
it would break again at the next cosmetic edit. Your **Daily By Route/Stop/Hour**
operation returns `Direction`, which is why we key that one differently, and why
it has never had this problem.

**Why we are raising it rather than just handling it.** Our loader was keyed on
route/stop/day-of-week, so the second record silently replaced the first. March
2026 was short **855 departures** — 90.46% against a true 90.50%, immaterial in
itself, but invisible. We only found it because every other figure had become
stable. We now add the pair together, which reproduces the correct total, and
March re-pulled to **90.50%**. That is correct for a pair that partitions a
month. It is wrong for a pair that repeats one, and without a discriminator we
cannot tell those apart from the record alone — we are inferring it from the
weekday arithmetic each time. That is the gap we would like to close.

Thanks again for running this down.

Tyre

# END OF MESSAGE. NOTHING BELOW THIS LINE GOES TO AVAIL.

---
---

# PART 2 — MVTA NOTES. DO NOT SEND.

## Status of the thread

The three questions we were holding are closed:

1. **Month boundary** — fixed by Avail, verified by Avail for September, and
   confirmed independently from our own data across all ten months of 2026.
2. **`Include Outliers`** — Avail confirms BI runs it True, which is what we
   send. This had been our hypothesis for the denominator gap; it was never the
   cause.
3. **Default thresholds when unspecified** — moot, we send all seven explicitly.

One is open and in Part 1, and it is not blocking. If Avail answers it with
"by design, no such field," summing stays correct and nothing further is needed
— but it will recur at the next mid-month rename, and we will keep having to
date it by arithmetic.

## Figures in Part 1, verified on dev 1 Nov 2026

Queried against `dbo.OtpMonthlyRouteStopDay` on `sqldb-mvta-onboard-dev`:

- September 2026: 62,538 departures, 50,781 on time, **81.20%**. Per route 420
  89.17, 465 66.33 (4,045 departures), 475 56.79, 495 80.81. All as stated.
- March 2026: 1,081 stored keys, 67,330 departures, 60,936 on time, **90.50%**.
- All ten months carry `measurement_parameters = 2/5/10/60/0/1/1`.

**One figure in Part 1 is inherited, not re-verified:** the surplus-day
percentages (3.6–4.0% weekday, 1.6–1.7% weekend) come from the 28–29 Oct
re-pull analysis, and the pre-fix totals they are computed against are no longer
stored, so they cannot be recomputed from the table today. The two the
working-group brief recorded in full do check out — 202608 65,278 → 62,748 is
-3.88%, 202609 65,158 → 62,538 is -4.02%.

The 27 collision records and their differing fields come from the poll's own
collision log in App Insights (`appi-mvta-onboard-dev`), from the March re-pull
on 31 Oct 2026 — so the "only `StopInternetName` differs" claim in Part 1 is
read off the delivered payload, not inferred from the stored rows.

## Correction to the earlier draft: the rename is 16 March, not 18 March

An earlier draft of the identifier question dated the change to **18 March** and attributed it
to a **service pattern change**. Both were wrong, and they were wrong together,
because the assignment was back to front: it assumed the *larger* count was the
earlier part of the month. The collision log shows the opposite — the record
carrying the **old** spelling is the **smaller** one, holding the first two
occurrences of each weekday.

Fitting all 27 pairs against every candidate date in March 2026 gives exactly one
answer:

| Boundary | Pairs consistent | Pairs inconsistent |
| --- | --- | --- |
| 14 Mar | 25 | 2 |
| 15 Mar | 26 | 1 |
| **16 Mar** | **27** | **0** |
| 17 Mar | 22 | 5 |
| 18 Mar | 17 | 10 |

So 18 March is not merely imprecise, it is contradicted by 10 of the 27 pairs.
And the cause is a **stop rename**, dated by the name that each half of the pair
carries — not a schedule change. February returns only the old spellings and
April onward only the new, which is what fixes the direction.

**Do not reintroduce the service-pattern reading.** The weekday arithmetic dates
*a* change; only the names say *what* changed.

`functions-restapi/src/lib/otpMonthlyFeed.ts` still carries the old reading in
the "Two records, one key" comment block — it says the split "is what a
mid-month schedule change looks like" and dates it to "about 18 March". That
comment needs correcting, but not here: this change is documentation only.

## The sweep: what else was considered for this message

### The eleven rows Avail no longer returns — our decision, not Avail's question

Eleven stored rows across three months are not returned by the current response,
and our MERGE has no delete clause, so they survive. They are identifiable
exactly: a row the latest poll did not return never received migration 151's
parameter stamp, so `measurement_parameters IS NULL` names all eleven and
nothing else.

| Month | Rows left behind | Their day of week | That month's surplus day under the old defect |
| --- | --- | --- | --- |
| 202605 | 8 | all Mon | Mon 1 June 2026 |
| 202608 | 2 | both Tues | Tues 1 Sept 2026 |
| 202609 | 1 | Thur | Thur 1 Oct 2026 |

Every one falls on its month's surplus weekday. They are residue of the defect
Avail has already fixed: the pre-fix response reached one day into the next
month, so a route/stop combination that ran on that surplus day but not on that
weekday within the month itself appeared as a record of its own.

The September row is confirmed against a second, independent feed. It is route
499 at stop 31967 (Shakopee Walmart), Thursday, 17 departures. In the daily feed
that stop joined route 499 on **29 September 2026** and so appears on a Tuesday
and a Wednesday in September and on no September Thursday at all — and Thursday
**1 October** returns exactly **17** departures. The stale September row is
1 October's Thursday, left in September by the old 31-day span.

**Arguing it the other way,** which is worth doing: only Avail knows its own
route and stop configuration, so "has this combination been retired?" looks like
a vendor question; and if Avail ever drops records in error — as it just did with
the date span — our table silently keeps the old value and nothing tells us.
Establishing whether absence is meaningful has real value.

**It is still our decision, for four reasons.** All eleven are explained without
asking. None is retired — every one of the eleven keys is present in later
months. Their survival is caused entirely by our own missing delete clause, so
asking Avail would be asking them to explain our loader. And the policy question
— should a monthly re-pull be authoritative for that month, or merge into it? —
is about our code, not their feed.

**Immaterial, and it does not touch the figures in Part 1:**

| Month | Stored | Excluding the eleven |
| --- | --- | --- |
| 202605 | 67,532 / 87.56% | 67,465 / 87.57% |
| 202608 | 62,748 / 85.30% | 62,746 / 85.30% |
| 202609 | 62,538 / 81.20% | 62,521 / 81.20% |

September's 81.20% is unchanged, so the reconciliation table in Part 1 stands
either way.

**Follow-up (ours, not in this change):** make a month re-pull authoritative for
that month — retire or delete rows the response no longer carries. The
`measurement_parameters IS NULL` signature already identifies the eleven
precisely, so the clean-up needs no detective work. Needs code and probably a
migration.

### The daily feed has no comparable gap

`OtpByRouteStopDayHour` cannot be split by a rename the way the monthly
aggregate is. Its grain is a single calendar date, each record carries its own
`CalendarDate`, and a rename simply changes `StopInternetName` on later dates'
records — the name is not in the key and never needs to be. The key gained
`Direction` in migration 123 for a different reason: Avail returns one record per
direction a route serves a stop in an hour.

Verified on dev 1 Nov 2026 (`dbo.OtpDailyRouteStopHour`, 14 Sept – 30 Oct 2026):
**82,389 rows on 82,389 distinct keys** including direction — and 65,870 without
it, so direction is separating 16,519 records that would otherwise collide.
Nothing to ask Avail about.

**One gap of ours, though:** the daily upsert has no collision detection. It
MERGEs record by record, so a same-key delivery would silently overwrite —
precisely the failure the monthly feed had for March, which we only found because
we had added detection. Lower stakes, since the daily feed is a cross-check
rather than the stored figure, but it is the same blind spot. Ours, not Avail's.

### Considered and dropped

- **Restatement-ledger volume** (377–904 rows per month in
  `dbo.OtpMonthlyRestatements`). Fully accounted for by our parameter correction
  plus Avail's month-boundary fix, both of which rewrote every month. Not a
  signal, not a question.
- **Day-of-week spellings.** Avail returns `Tues` and `Thur`, not `Tue`/`Thu`.
  Migration 021 already widened the column for it. A quirk we handle, not worth a
  vendor's time.
- **`LateOutlier` / `PercentLateOutlier`.** Present in the payload, unmapped by
  us. We send `Include Outliers = 1`, so outliers are inside `Total` and the
  compliance figure does not need the breakdown. Worth mapping one day; not a
  question for Avail.
- **Null counts.** None. No stored row has a null `total` or `ontime` in any
  month.

### The date format: settled, not asked

The plan had been to send one direct call with a day-of-month above 12
(`03-20-2026`, where a day-month reading would be month 20). That turned out to
be unnecessary, and it was also not available: the key is a Key Vault reference
and `kv-mvta-dev-mvta-jx4471` has public network access disabled, so it cannot
be read from a laptop. Neither the poll nor the backfill can make the call
either — both build the 1st of the month via `monthToDate`.

**The evidence was already in the message.** We request `09-01-2026`, label the
response 202609 ourselves (`mapOtpMonthlyReport` stamps the request's own
service month onto each row — the response carries no month of its own), and
those rows reconcile with Avail's BI **September** report route by route,
including route 465 at 4,045 departures. Under a day-month reading the request
would have been 9 January and we would have stored January's aggregate — 61,203
departures at 90.63% — under the September label. It would not have reconciled
with anything. So the format is confirmed by the reconciliation itself, and no
new call is needed.

A caveat that does not affect the conclusion: the `01-01-2026` request is
identical under both readings, so January's own row proves nothing. The proof
rests on September, where the two readings differ and only one matches BI.

**So it is not asked.** It was briefly reduced to "which format would you rather
we sent" before being cut: a preference question with no defect behind it earns
nothing from a vendor we are also asking for a schema change, and it would have
diluted the one question that matters. If Avail ever deprecates MM-DD-YYYY they
will tell us, and `formatDateMmDdYyyy` in `availClient.ts` is the single place
that would change.

**One incidental finding, ours:** `/api/feed-checks` probes the monthly
operation with `month: now` — the raw current date, not the 1st. So on any day
after the 12th it sends a day-month value above 12 to `OtpByRouteStopDayAgg`,
and has been doing so for months. That is a second confirmation sitting in the
feed-check history, and it is also a small inconsistency: the probe does not
send the request the poll sends, which is the exact failure the one-adapter
refactor in `availClient.ts` was written to end. Not worth a change on its own,
but worth knowing.

## What remains, and none of it depends on Avail

1. Restate the Tier A acceptance standard — it was written against figures taken
   with the wrong early threshold and a one-day-too-wide window, and two of the
   three decision months now cross the 85% boundary.
2. Complete A0 — reconcile the weekly CSV against the canned monthly report
   before either is treated as a baseline.
3. The two code follow-ups above: an authoritative month re-pull, and collision
   detection on the daily feed. Plus the stale comment in `otpMonthlyFeed.ts`.
