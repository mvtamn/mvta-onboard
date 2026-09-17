# Change Detour Workflow Only Through Named Acts

**Status:** accepted

An authoritative Detour's Workflow state, fulfillment mode, Outstanding
re-review, and Conflict override change only through named Detour workflow
acts — promotion, direct creation, Avail entry result, manual fallback,
closure, Conflict override, recording an edit (which raises Outstanding
re-review when reviewed facts actually change), completing re-review, and Avail
feed observation. Each act is decided and recorded in one place, together with
its single audit entry, and there is no general "set Workflow state"
operation.

A general transition endpoint existed and no console page used it, but it
could reach `fulfilled` without the Conflict override gate that Avail entry
confirmation enforces, and it recorded human changes as Avail changes. Named
acts carry their own prerequisites (a reason to close, a resolved conflict and
no Outstanding re-review to confirm an Avail build) and say what operationally
happened, which a bare target state cannot.

**Consequences:** a new operational need is added as a new named act rather
than by writing Workflow state directly. Approval is the promotion of a Detour
intake, not a stored state. A Detour first seen in the Avail feed is
Avail-backed and fulfilled without Avail build confirmation.
