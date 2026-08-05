-- Migration 019: Detours.avail_last_seen_at.
--
-- Part B5 of detour-and-event-module-implementation-plan.md: when the Avail
-- Detours sync (Part B4) finds an existing source='avail' row that a human
-- has since hand-edited (last_edited_manually = 1), it must NOT overwrite
-- the editable fields - but it should still record that the sync is still
-- seeing this detour in Avail's feed, so staff can tell the sync hasn't
-- silently stopped tracking it. This column is that lightweight marker,
-- updated on every sync pass regardless of last_edited_manually.

ALTER TABLE Detours ADD avail_last_seen_at DATETIME2 NULL;
GO

PRINT 'Migration 019 applied: Detours.avail_last_seen_at added.';
