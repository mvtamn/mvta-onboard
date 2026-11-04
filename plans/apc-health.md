# APC health: the incumbent report vs a combined view, and what OnBoard's page should be

Status: comparison done and page design agreed 2026-11-04 (§6). Not built.
Related: ridership counting spec §12 (Avail APC feed) and gap C8 (OPR-038 lets an APC count
replace a paper count when APC is "sufficient"). This page is what would define "sufficient".

## 1. Question

The thesis: OnBoard's advantage is that it **combines several data sources to show where the
problems are**, where the incumbent report only lists counter status. This tests that on five
real service days, 2026-10-24 to 10-28 (Sat, Sun, Mon–Wed): 348 bus-days, 2,300 revenue trips.

## 2. The incumbent: UTA "APC Daily Total Listing"

A text report from UTA's APC software ("Run on MVTA-UTA", batch file `DMPD2609.DAT`), covering
2026-08-26 to 11-01. It is not from Avail360, though it uses Avail's counts.

**Row** = one bus × one calendar day. 5,645 rows, 139 buses. Columns: On, Off, day type, date,
bus, miles, hours, APC serial, wheelchair, bike, init records, data gaps, count jumps > 90,
records, CWOC (% of door-close records with no count), door closes, `104` (% of records with
no GPS in revenue service), RdrTC (riders per door close), pull-out and pull-in garage, miles
from garage at pull-out and pull-in, and **Delta** (% difference between ons and offs, printed
as `---` when the day is too small).

**Per bus**: a footer with on/off totals, overall Delta, passengers per mile, the date range
and record counts.

**Fleet summary**: 155 buses in `APCBus.ref`, 139 reporting (89.7%), "3 with suspect counts",
"2 with suspect GPS", 134 "good counts and GPS", and a "No data" list of 19 buses.

What "healthy" means there: the report never says. It has no per-bus verdict. The summary
counts 3 "suspect" buses but doesn't name them; a reader judges each bus from Delta, zeros,
CWOC and `104` by eye.

What it can't tell you, by construction:
- **Which trips, routes or riders were affected.** There's no trip, block or route on any row,
  only day totals per bus.
- **Whether the bus was in revenue service.** Counts from Connect (pseudo-route 4444),
  training and maintenance moves sit in the same daily total.
- **When in the day a counter failed.** A counter that quits at 16:00 makes a normal-looking
  day with a modest Delta.
- **What normal looks like for that bus's work.** Delta is judged against zero, but some routes
  run unbalanced on every bus (§3.4).
- **How long a fault has been open.** The history is all there, but nothing tracks it.

What it has that OnBoard's sources don't: **door-level diagnostics.** Door closes, CWOC, GPS
dropouts, data gaps and count jumps can tell a dead sensor head (doors cycling, no counts) from
a dead unit (no records) or a GPS fault. Avail's trip feed has none of that.

## 3. What combining sources shows

Sources joined, all verified in dev SQL and the Avail sample:

| Source | Grain | Gives |
|---|---|---|
| Avail360 `ApcRidershipBySvcLvlBlockRouteTripTimepoint` | stop × trip | boards, alights, null StopName = not placed at a stop; pseudo-routes; **no vehicle** |
| Dispatch Log `TripStartLog` | scheduled revenue trip | the trip list and start status |
| `GtfsTripOperationalEvidence` (GTFS-RT) | trip × day | **the vehicle that ran each trip**, and when it was moving |
| `FixedRouteDepartures` (Avail pull-out) | block × day | pull-out bus, garage and logon. One bus per block, so it's wrong for swaps (15 trips on 10-28) |

**The join is clean.** APC `Block` + `RouteID` + `Direction` + `Trip` (scheduled start HHMM)
matches `TripStartLog` 1:1 on all 2,300 trips. The only catch: GTFS calls route 425 "Orange
LINK", so it needs an alias. Every trip gets its bus from GTFS-RT.

**The counts are the same counts.** Per bus-day, the trip feed's boardings match UTA's On to
the rider on almost every bus. OnBoard doesn't see more riders; it sees context. The 5
exceptions are bus-attribution differences (Avail's vs GTFS-RT's idea of which bus ran a trip).

### 3.1 Bus-day comparison

Flag rules. Incumbent: a zero day, or Delta ≥ 25%. Combined: zero on every trip while
GTFS-RT shows the bus moving; or ≥ 2 *surprising* zero trips (zero on a trip that averages ≥ 3
boardings on other buses and days); or boards ÷ alights ≥ 35% off that route's own balance,
with ≥ 40 riders.

| | Bus-days |
|---|---|
| Both flag | 8 |
| UTA only | 12 |
| Combined only | 6 |
| Neither | 322 |

### 3.2 Both catch the blunt faults, and the incumbent sat on them

- **Bus 4143: dead counter.** On every day in the report (39 service days since 08-27): 0 on,
  0 off, while it logged 276–335 door closes a day. The combined view adds that it ran 16
  revenue trips over 3 of these 5 days on 420/425/444/495, moving on every one (≈130 riders
  uncounted over the 5 days at those trips' usual loads). The incumbent shows the fault every day; nothing
  made anyone act on it in nine weeks.
- **Bus 4509: boarding sensor failing since 10-23.** Ons fell from 85 to 10 a day while offs
  stayed at 32–100 on full days. UTA shows it as a rising Delta (34% → 87%); combined adds that 6 of its
  trips read zero on routes that usually carry riders.

So **detection is not the gap for blunt faults; follow-through is.** A page that only lists
status repeats the incumbent's failure.

### 3.3 Combined only: counters that stop partway through the day

Daily totals hide these. The trip timeline shows them:

| Bus-day | UTA shows | Trip timeline shows |
|---|---|---|
| 4129, 10-27 | 11 on / 7 off, `---` (no flag) | Counted the 06:26 and 07:40 trips, then **zero on all 7 trips from 10:10**, route 446 (~31 riders) |
| 4512, 10-26 | 47 / 39, Delta 17% | Normal until 15:03, then **zero on all 5 trips from 16:07**, route 444 (~47 riders) |
| 4843, 10-27 | 90 / 54, Delta 40% (flagged, no cause) | 41 on / 6 off on the 14:13 trip, then **zero from 16:13** (~54 riders) |

Each bus counted normally on the other days, so this is an intermittent fault (a reboot or
power loss mid-day, or a sensor freezing). Only trip-level data can see that, size it in
riders and date it.

The other three combined-only bus-days are two buses with 2 surprising zero trips each (4127,
4844; small) and two with boards ÷ alights ≥ 35% off their routes' norm (4777, 4840).

### 3.4 UTA only: mostly false alarms the combined view explains away

Of the 12 bus-days only UTA flags, most are:
- **Route effects.** On 460 and 465, boardings run 20–24% above alightings **on every bus**
  (32 and 26 buses). A bus that spends the day on 460/465 shows Delta 25–30% with a healthy
  counter (4485, 4836, 4951). Judging a bus against its routes' norm removes them.
- **Small days.** Delta of 25–31% on 20–50 riders is within noise (4847, 4141, 4266, 4518).

Kept as a real miss on the combined side: **4838 on 10-28** (3 on / 31 off over 2 trips),
under the combined rule's 40-rider floor. The floor should apply to the route-adjusted test,
not to an off-by-tenfold ratio.

### 3.5 Coverage the incumbent misstates

- **The 19 "No data" buses ran no revenue trips on any of the 5 days.** Every bus-day of
  revenue service had APC data. The incumbent's 87.7% "reporting" is a fleet-roster figure;
  revenue-service coverage was 100%.
- **Garage attribution in UTA is stale.** It reports "BURNSVILLE 0 of 0 APC's", while 38
  Burnsville buses sent data: `APCBus.ref` files the whole fleet under Eagan. Pull-out has the
  garage per bus per day.
- **Non-revenue counts are mixed in.** 12 UTA bus-days with 419 boardings came from buses
  with no revenue trip that day: 4077 working Connect (pseudo-route 4444) on 4 days, plus
  training and maintenance moves.

### 3.6 Feed-level problems (not bus faults)

- **Deadhead boardings: 5.4–7.8% of revenue boardings** (311–371 a weekday), spread over
  115–119 blocks. Too widespread for counters; likely trip-boundary matching (riders boarding
  at the origin before the trip "starts"). Those riders are missing from revenue trips.
- **Boardings not placed at a stop**: 0–17% by route, highest on 420 (17%), 425 (15%), 460
  (13%) and 447 (12%).
- **Avail's APC API isn't dependable day to day.** Fetched 11-03: 10-29 returned an SQL error
  (`varchar 'null' to int`); 10-30, 10-31 and 11-01 returned empty, while UTA already had
  10-30. A health page has to show feed freshness and refetch gaps.
- **The raw zero-trip count overstates faults about fourfold.** 163 all-zero trips in 5 days;
  only 41 were surprising for that trip. The rest are quiet circulator trips (497/499) that
  were probably empty.

### 3.7 Verdict on the thesis

**Holds, but not the way it was put.** The incumbent already shows the worst faults; what it
lacks is (1) trip-level timing, which catches mid-day failures it can't see; (2) route context,
which removes most of its Delta false alarms; (3) revenue-service context, which corrects
coverage and drops non-revenue counts; (4) impact in riders and trips; and (5) any tracking, so
a dead counter sat for nine weeks. Where OnBoard is weaker is diagnosis: door, GPS and record
diagnostics live only in UTA.

Not yet tested: **APC vs manual by bus vs by operator** (counter fault vs sheet problem). It
needs trip-level manual counts; the apc-manual-compare session is waiting on that export.

## 4. Health signals, ranked by what they found

| Signal | Source join | Found | Kind |
|---|---|---|---|
| Zero on every trip while moving | APC × TripStartLog × GTFS-RT | 4143 | dead counter |
| Counter stops mid-day (all trips zero after time T) | same | 4129, 4512, 4843 | intermittent |
| Boards ÷ alights vs route norm | APC × route baseline | 4509 (0.36), 4838 | one sensor failing |
| Surprising zero trips (vs same trip's usual load) | APC history | 41 of 163 zeros | spot dropouts |
| No APC rows for a trip that ran | APC × TripStartLog | none on these days | feed or unit |
| Revenue bus with no APC data | GTFS-RT × UTA/APC | none (19 "no data" were idle) | coverage |
| Deadhead / unplaced share | APC pseudo-routes, null StopName | 6%, 0–17% by route | feed quality |
| APC ÷ manual by bus vs by operator | APC × manual counts | not yet | calibration |

## 5. Proposed page: APC Health

The page is a **fault register with evidence**, not a daily listing. One row per open problem,
kept open until the counter proves clean.

1. **Header line** (figures illustrative): "Last 7 service days: 98% of revenue trips counted · ~310 riders
   uncounted · 3 open faults · APC feed current to 10-28 (10-29 failed, 3 days missing)".
2. **Open faults** (the main list): bus · fault kind (dead / boarding sensor / alighting
   sensor / stops mid-day / spot dropouts) · since (onset date) · days open · revenue trips
   affected · riders uncounted (estimated from each trip's usual load) · status (new →
   reported → fixed, verifying → closed). Auto-closes after N clean service days.
3. **Bus detail**: a day strip (one cell per service day, clean / fault / not in service)
   and, for a chosen day, the trip timeline (start, route, boards/alights per trip, zeros
   marked), which is the view that showed the mid-day stops. Pull-out garage, and later the
   UTA door diagnostics.
4. **APC-sufficient buses** (gap C8): clean-day streak per bus, and the list of buses that
   meet the rule, i.e. the buses that could skip paper counts.
5. **Explained, not faults**: route imbalance (460/465), quiet trips, non-revenue counts,
   idle buses, each with why it was excluded, so nobody re-raises them.
6. **Feed quality**: Avail API freshness and gaps, deadhead share, unplaced share by route.

Rows hold bus numbers only. No operator names or logon IDs anywhere on the page.

## 6. Decisions (agreed 2026-11-04)

1. **Faults are tracked and notified.** OnBoard keeps a fault register with status (new →
   reported → fixed, verifying → closed). A new fault notifies the maintenance contact (Keolis
   from 2027-01-01) and stays open until the bus has N clean service days. A list nobody acts
   on is the failure this page exists to fix.
2. **"APC-sufficient" (C8) = clean streak + manual check.** For now: no open fault and 20
   consecutive clean service days. Once trip-level manual counts exist, the bus's APC ÷
   manual must also sit within an agreed band. Band and N are still to be set; the
   apc-manual-compare work should inform the band.
3. **It lives in the Ridership module** as a tab, replacing the made-up "APC comparison"
   tab, because sufficiency decides which buses still need paper counts.
4. **UTA diagnostics later, not v1.** v1 runs on the Avail trip feed, Dispatch Log, GTFS-RT
   and pull-out. Bring in the UTA listing (door closes, CWOC, GPS dropouts, gaps) once we know
   how it's produced and where it lands, so the page can say *why* a counter failed.

Still open: clean-day N for auto-close, the APC ÷ manual band, who the maintenance contact is
before and after Keolis, and the route-425 "Orange LINK" alias's home (a mapping table, not
code).

## 7. Method (reproducible)

APC JSON per day from `fetch_apc_sample.sh` (kept outside git in `ridership/avail-apc-sample/`).
Dispatch Log, GTFS-RT evidence and pull-out read from dev SQL (`service_date` is
`'YYYYMMDD'`; GTFS-RT timestamps are UTC). Pseudo-routes 999, 1010, 1118–1128, 1121, 4444,
5555, 6666 and 7777 are set aside. "Surprising" zero: the same route, direction, start and
day type averages ≥ 3 boardings on other buses and days (Poisson P(0) ≤ 5%). Route balance
excludes the two known-faulty buses. Five days is thin for baselines; the page should use a
rolling 4–8 weeks.
