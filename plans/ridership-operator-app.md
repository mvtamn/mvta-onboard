# Ridership — Operator App

Date: 2026-10-30. **Not implemented.** Decisions agreed with the user in a
grilling session on 2026-10-30. This is the later stage of
`plans/ridership-counting-spec.md` §4 and §13 ("operators enter their own
counts once v1 is proven"), and it supersedes §13's draft where the two
differ. Section numbers below (§2, §5 …) refer to that spec.

## Summary

A mobile-friendly responsive website where an operator signs in, picks their
run (block), enters each trip's boardings total and submits. It is used on a
**driver kiosk** at the garage, or on the operator's **own phone** once OPR-038
allows it. It supplements the paper Count Sheet first and then replaces it:
once a run is submitted, the submission is the record and OCC no longer keys
that sheet.

What it is for: near real-time reporting (same day instead of next day),
simpler reporting, and removing OCC's re-keying of paper.

## Decisions

### Device and where it runs

1. **No hardware on buses, and no MDT change.** Both are ruled out. The app
   is a website, not a device programme.
2. **Driver kiosk first.** A shared screen at the garage pull-in point,
   locked to the operator site. Kiosk provisioning (devices, number per
   garage, who supplies them, placement) is a **separate scope to be
   developed**; not designed here.
3. **Operator's own phone later.** OPR-038 bans personal electronic devices
   on duty. MVTA may amend that after consulting the contractor; phone use
   starts only after the amendment, and is voluntary. The kiosk is always the
   fallback.
4. **Where it lives:** a new Vite package `frontend/packages/operator-app`,
   like `rider-app`, at its own address, on the same REST API, with its own
   operator sign-in. Not a console route (the console is Entra-only and
   staff-shaped). Installable to a phone home screen so it keeps working
   through dead zones.

### Scope

5. **Fixed route only.** Connect ridership comes from Spare (§1).
6. **Buses with APC:** operators count on every bus until §12's validation is
   done; after that, manual counting continues only on buses without a
   validated APC counter.

### Sign-in

7. **Avail logon ID + a 6-digit OnBoard PIN**, on kiosk and phone alike.
   Operators are Keolis employees with no account in MVTA's Entra; no B2B
   guest per operator.
8. **The check-in desk issues PINs.** First sign-in uses a one-time PIN from
   the desk, which the operator changes. 5 wrong tries locks the PIN until the
   desk resets it. The desk can set or reset PINs only for logon IDs in
   Avail's operator data.
9. **Sessions:** a kiosk session ends after each submission or 2 minutes of
   inactivity; a phone session lasts one service day.

### Entering counts

10. **Choose the run (block), then enter counts.** The operator selects the
    run from a list for the service date; runs Avail's pull-out report
    (`FixedRouteDepartures`) shows them logged into are listed first. The run's
    trips come from the Dispatch Log, in order, as on the Count Sheet (§2).
11. **Run not confirmed by Avail** (no MDT login, or the operator picks a run
    Avail shows for someone else): the submission is accepted, marked
    **block not confirmed by Avail**, and OCC confirms it. It still counts as
    on time.
12. **One boardings total per trip** (§2). On the kiosk the operator tallies
    on paper during the trip and keys the totals at pull-in.
13. **Did not operate:** the operator can mark a trip. A trip with a confirmed
    missed-trip case shows as *Missed — no count needed* and takes no count.
    An operator's "did not operate" is shown to OCC but does **not** excuse a
    missing count (§5); only a confirmed missed-trip case does.
14. **Unscheduled trips:** route, direction, start time and a reason from a
    short list (tripper, double-out, OCC-directed, other), as on the paper's
    blank rows (§4).
15. **Relief mid-run:** one submission per run (matching §8's one occurrence
    per sheet). Any operator Avail shows on that run can open it and add
    their trips while it is open; OCC handles the cases that don't fit.

### Submit, timeliness and corrections

16. **Submit counts as the entered sheet**, under §5's deadline unchanged (end
    of the calendar day after the service date, Central). The contract rule
    and the Incident and Data Reporting occurrence (§8) keep their meaning.
17. **Drafts are saved as the operator works.** If an operator leaves without
    submitting, the check-in desk sees the run in a *not yet submitted* list,
    and OCC can submit the saved draft, recorded as *OCC from draft*.
18. **Offline:** entries and Submit are queued on the device and sent when
    there is signal; resending never doubles a count (each submission carries
    a unique key). The recorded submission time is when the operator pressed
    Submit. The screen always shows *Saved on device* or *Sent*. A submission
    arriving more than 24 hours after it was made goes to OCC.
19. **Corrections:** the operator can reopen their own submission until the
    end of the service date. After that only OCC (`ridership-recorder`) can
    change it, through the existing flag and correction process (§6), with
    who and when recorded.

### Paper

20. **The submission is the record; paper is a tally card.** For a run
    submitted on the kiosk or phone, the paper sheet is not handed in, kept
    or keyed by OCC, and §8's retention rule no longer applies to it. Paper
    and app are **not** run in parallel as two records, except during the
    pilot (decision 24). A run with no submission falls back to the paper
    process unchanged.

### OCC and reporting

21. **Submitted runs drop off OCC's entry worklist** (§4), with a filter to
    show them. OCC reviews them through flags, not by re-keying.
22. **Count source** is recorded on every sheet: *kiosk*, *phone*, *OCC from
    paper*, *OCC from draft*. The completeness view (§5) gains a Source column
    so the move away from paper can be measured by garage.

### Accessibility

23. WCAG 2.2 AA. Large number fields with a numeric keypad, numbers-only
    entry, high contrast; works on a kiosk screen and a phone.

### Rollout

24. **Kiosk pilot at one garage**, starting no earlier than after the March
    2027 month close (two clean OCC-entry closes first). For 4 weeks OCC also
    keys that garage's paper, and the two are compared trip by trip, as
    December compares Access with OnBoard. Then the garage stops OCC keying
    and the other garages follow.
25. **Phone mode** is piloted once OPR-038 is amended.

## Future (out of scope, kept for later)

- **Live counting on the phone** during the trip: a +1 tally per trip.
  Needs both items below, for safety and accuracy.
- **Moving-bus lock** from the phone's own GPS speed (about 3 mph). Not
  OnBoard's AVL: it is polled every 15 seconds (`availAvlPoll`,
  `gtfsVehiclePositionsPoll`), so it would be wrong both just after pulling
  away and just after stopping.
- **Automatic current trip:** move to the next trip at the later of the
  scheduled start and the Dispatch Log's recorded start, with an override.
- **Tap times** (time of each +1, no location) as evidence that counting
  happened during the trip. Only possible with live counting.

## Steps outside the code (numbered, owner in brackets)

1. Consult the contractor and, if agreed, amend OPR-038 to allow phone use
   for passenger counting, voluntary. [Planning + Operations]
2. Agree work rules with Keolis: kiosk time at pull-in is paid time; phone
   use is voluntary. Precondition for the pilot. [Operations, with Keolis]
3. Develop the kiosk provisioning scope: devices, number per garage, supplier
   (MVTA or Keolis), placement at the pull-in point. [Operations + MVTA IT]
4. Create the operator credential: a store of Avail logon ID → PIN hash,
   lockout and reset, in OnBoard. Operators are not Entra users, so this is a
   new sign-in path for the REST API, not an app-owned role (ADR 0032)
   assignment. Needs an ADR before code. [Engineering]
5. Seed a new app-owned role **`ridership-operator-admin`** (set or reset
   operator PINs only) in the app-owned roles table. [Engineering]
6. Assign `ridership-operator-admin` to named check-in desk staff at the pilot
   garage, as Entra B2B guests per spec §11 step 2. [MVTA IT + an access
   administrator]
7. Give the operator site its own address (DNS and hosting, alongside
   `rider-app`). [Engineering + MVTA IT]
8. Add the terms below to `CONTEXT.md`, together with the spec's terms,
   before code is written. [Engineering]
9. Amend the contractor procedure (`plans/ridership-counting-procedure-draft.md`)
   for operator submission at the pilot garage. [Planning + Operations]

## Terms for `CONTEXT.md`

| Term | Meaning |
|---|---|
| **Operator submission** | An operator's own entry of a run's counts in the operator app. Replaces the Count Sheet as the record for that run. |
| **Count source** | Where a sheet's counts came from: kiosk, phone, OCC from paper, OCC from draft. |
| **Driver kiosk** | A shared screen at a garage, locked to the operator app. |
| **Operator PIN** | The 6-digit secret that, with the Avail logon ID, signs an operator in to the operator app. |
