# ADR 0014: Publish Event scope snapshots at activation

An Event Service Plan may be previewed after approval, but only activation
publishes an immutable operational scope. Approval therefore requires a
complete executable scope, while Event AVL, crossing detection, notifications,
and audit read the published snapshot rather than mutable planning links.
Incomplete or incorrect non-active plans are repaired through a draft or
reviewed revision and the normal approval/activation workflow; active scope is
never repaired by direct mutation. Activation is atomic and fails closed when
the published snapshot is missing or invalid; Event AVL never falls back to
mutable planning links. Resource changes are recorded against the Event and
plan or revision for audit.

**Status:** accepted
