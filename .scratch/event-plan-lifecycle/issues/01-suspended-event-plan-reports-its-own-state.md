# 01 — Suspended Event Plan reports its own state

**What to build:** A planner opening a suspended Event Plan sees a next action
stating that the plan is suspended. Today the same screen renders a suspension
banner and a "completed" next action at the same time, telling the operator two
contradictory things about one plan. This is a live operator-facing defect, not
only a structural concern, and it ships ahead of the lifecycle refactor that
would otherwise carry it.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A suspended Event Plan's next action states that the plan is suspended
- [ ] Suspended and completed resolve to distinct next actions
- [ ] A completed Event Plan's next action is unchanged
- [ ] The suspension banner and the next action no longer contradict each other
- [ ] The domain glossary's active-scope suspension entry describes suspension
      as terminal today, naming the absent resume and complete exits as known
      gaps rather than implemented behaviour
- [ ] Console version incremented
