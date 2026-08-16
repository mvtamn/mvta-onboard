# Event AVL monitoring trust states

**Status:** accepted

Event AVL is optimized for the Incident lead and keeps active vehicles, open
Event notifications, and feed health as the primary operational read. Open
notifications include pending, acknowledged, and failed work; read-only users
still see their details, while action controls name the required role.

Live vehicle positions remain visible after two missed AVL polling intervals but
are marked stale and cannot support “reporting now” claims. Supporting feed
failures produce degraded monitoring: affected claims and actions are
suppressed while trustworthy vehicle data remains visible. Authentication
expiry produces authentication-blocked monitoring: live vehicles, alerts,
history, crossings, and audit are unavailable until sign-in, while the selected
Event and Service Plan are preserved.

When an Event has more than one active Service Plan, Event AVL requires explicit
operating-period selection; it may select the sole active plan automatically.
Any scope transition pauses affected actions until the replacement scope is
loaded or explicitly selected. Operator-facing states remain distinct as
Loading, No results, Stale, Degraded, Unavailable, and Authentication required.

These distinctions prevent empty, stale, degraded, unauthenticated, and
permission-limited views from being interpreted as the same operational fact.

## Monitoring surface hierarchy

The Event AVL first viewport makes the live vehicle map and vehicle list the
dominant work surface. Open notifications and feed health remain open and
visible. Scope review and Teams delivery are secondary controls; Teams delivery
shows a compact current-state marker and opens only when configuration is
needed. A healthy feed does not need a success banner because the live metrics
and health indicators already communicate readiness.

The workspace lifecycle stepper is omitted from Event AVL because it duplicates
the shell navigation and selected operating context. This preserves the
Incident lead's next action—observe and respond—without removing access to
planning or configuration routes.

## Edge-state interaction rules

- A healthy Teams delivery control remains collapsed but exposes its current
  state in the summary marker. The marker distinguishes Teams on from Teams
  off with messages queued in Event AVL and identifies read-only users. If
  delivery is unavailable or an action is blocked by degraded monitoring, the
  disclosure opens automatically with the explanation.
- A successful empty vehicle response is a visible No results state. It is not
  presented as loading, unavailable, or healthy flow.
- With multiple active Service Plans, Event AVL shows only the explicit selection
  state. Scope-specific content remains hidden until one period is selected.
- Capability-scoped degradation preserves vehicle refresh and filtering. Only
  claims and actions dependent on the degraded capability are paused.
