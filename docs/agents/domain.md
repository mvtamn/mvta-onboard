# Domain Docs

This is a single-context repository. Before exploring Event work, read the
root `CONTEXT.md` and the relevant records in `docs/adr/`.

Use the canonical vocabulary from `CONTEXT.md`: Event, Event operating
context, Service Plan, operating period, Scope contract, pinned resource,
unplanned vehicle, and Event AVL.

## Two meanings of "dispatch"

- **Dispatch** (verb, in code): delivering an approved message to Teams and
  other channels. Owned by `functions-dispatch` (`dispatchMessageCreated`,
  `dispatchConfirmation`). Use this word only for message delivery.
- **Dispatch Log** (product name): the OCS desk's record of whether each
  revenue trip started on time, kept today in a shared workbook. Its technical
  identifiers are `TripStart*` (`TripStartLog`, `TripStartVerifications`,
  `/trip-start-log`) precisely so they are not mistaken for message-delivery
  logs. See `plans/dispatch-log-spec.md`.
