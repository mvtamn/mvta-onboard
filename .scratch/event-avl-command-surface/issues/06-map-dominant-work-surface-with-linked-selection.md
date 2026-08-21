# 06 — Map-dominant work surface with linked selection

**What to build:** An Incident lead can see where the buses are and which bus
needs a call at the same time, without scrolling between them.

Replace the single scrolling column with two zones:

**Sticky context bar.** Event and operating period selectors, count chips for
Vehicles, Reporting now, Stale, and Scope exceptions that act as roster filters,
and a feed-age pill that expands to per-component health detail. This bar
absorbs and replaces the live-operations eyebrow, the metrics card, the context
band, the scope strip, and the health strip — five bands become one.

**Work surface.** Map and roster side by side, filling the remaining viewport
height, each scrolling independently, with the map the larger pane. Selection is
bidirectional: selecting a map marker marks the roster row, selecting a roster
row pans the map and opens a vehicle detail panel. Map markers move from hover
to tap so detail is reachable on touch. The map instance is not destroyed when
the layout changes, so pan and zoom survive.

Notifications stay where they are for now; ticket 07 moves them.

**Prerequisites:** 01 (extracted pieces), 05 (the roster it sits beside)

**Status:** ready-for-agent

- [ ] Map and roster are co-visible in the first viewport without scrolling, on
      a desk-sized window.
- [ ] Each pane scrolls independently; reading the roster does not move the map.
- [ ] Selecting a map marker marks the corresponding roster row.
- [ ] Selecting a roster row pans the map to that vehicle and opens the detail
      panel.
- [ ] Vehicle detail is reachable by tap, not only hover.
- [ ] Map pan and zoom survive layout changes and refreshes; the camera does not
      reset on the 30-second poll.
- [ ] The sticky bar carries context selectors, count chips, and feed age; the
      eyebrow, metrics card, context band, scope strip, and health strip are
      gone as separate bands.
- [ ] Count chips filter the roster, and an active filter is visible while
      applied so a filtered roster is not misread as the whole picture.
- [ ] The feed-age pill changes appearance as the feed ages and expands to
      per-component health.
- [ ] Filters are reachable without collapsing or displacing the map.
- [ ] Trust states survive intact: an expired session produces one page-level
      recovery state with subordinate sections labelled unavailable rather than
      empty; degraded capabilities pause only their own claims while vehicle
      refresh and filtering keep working; explicit operating-period selection is
      still required when an Event has several active plans.
- [ ] The console package version is bumped.

**References:** Event AVL Live Command Surface — Spec; Event AVL monitoring
trust states (ADR 0020); Zone-derived vehicle status (ADR 0026); Event AVL
field view boundary (ADR 0027); CONTEXT.md — Domain Context.
