# Separate the Issuance Proof from the Final Assessment

**Status:** accepted

The glossary defines a **Final Assessment** as the artifact the Issuing
Authority issues, and a **Finalized Assessment** as the internally approved
state before that. The report pipeline had a third thing with no name: the row
that "Generate Final Assessment" created — rendered, hashed, archived, but not
issued — and the code treated each such row as the latest Final that the next
one had to *supersede*. Supersession is reserved for issued artifacts (ADR
0006, 0013); applying it to renders nobody outside saw let a `finalized`
period grow v1, v2, v3 "finals" from one unchanged state.

That render is now an **Issuance Proof**: the exact bytes an Issuing Authority
checks before the run. It keeps the archived-preview guarantee of §9 of the
design (preview streams stored bytes, never a re-render) but is a different
kind of thing from the Final Assessment, with different rules:

- At most one live Issuance Proof per Assessment Period. Generating another
  **voids** the prior one (`voided_at`, audited); nothing is deleted.
- Any Material Assessment Change or reopen voids the live proof. So does
  finalizing: a proof is only ever prepared after finalization, so one that
  survives to a later finalization was rendered from state that went stale.
- A proof never participates in supersession. Only issued Final Assessments do.
- Issue transitions the proof's row into the Final Assessment and preserves the
  proof's own blob path and hash beside the issued ones, so both artifacts stay
  addressable.
- Report Version is a generation counter; voided proofs keep their number.

Supersession is **derived from period lineage, not supplied by the client**. A
correction period (one carrying `supersedes_period_id`, created when an issued
period is reopened) must supersede the latest issued Final Assessment of the
period it corrects, and a period without one cannot supersede anything. The
client sends only `supersede_reason`, captured at proof generation so the
issuer reads it on the proof, and immutable through issue. A reason on a
non-correction period is refused. A Superseding Final Assessment need not
differ in any figure from the one it supersedes; the recorded reason is the
record.

Considered and rejected: eliminating the pre-issue render entirely (loses the
archived preview the design chose deliberately), and a separate
`issuance_proof` row type with the Final inserted as a second row on issue
(moves the identity every existing foreign key points at, for no gain).

The same change adds a per-period application lock around generate and issue so
version allocation, blob upload, and the SQL write cannot interleave, and
tightens finalization to require one Assessment Item per standard in the
period's frozen Assessment Rule Set — a standard assigned to the Agreement
after the period opened waits for the next period, per ADR 0006.
