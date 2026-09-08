# Migration numbering

Files are `migration-<number>[<letter>]-<what-it-does>.sql`, applied in
numeric order. There is no runner and no schema-version table: the number is
how a human knows the order, and how everyone refers to a migration in code
comments, changelog entries and runbooks.

## The letter suffix resolves a collision

Two branches that both read the same `main` pick the same next number, and git
merges them without a conflict because the filenames differ. It has happened
five times. When it does, both migrations are usually already applied, so
neither can be renumbered to a free number at the end - that would claim it ran
after migrations it actually preceded. Instead the pair keeps its position and
a letter orders it:

| Number | a | b |
| --- | --- | --- |
| 032 | app settings | governed performance assessment |
| 055 | detour Avail entry confirmation | event crossing route |
| 069 | event geofence notification cooldowns | detour intake evidence and operations |
| 088 | dismiss within-variance garage departures | detour location |
| 096 | trip start verification events | on-demand departures |

The letter follows the order the two reached `main`, or the order they were
written when a single merge brought both.

`src/lib/migrationFiles.test.ts` fails when two files share a number, so a
sixth collision is a failing test rather than a question someone has to ask
months later.

## What a rename must never touch

A migration's number can appear inside the database, not just in its filename.
Those values are historical and stay exactly as written, whatever the file is
called afterwards:

- `migration-032b`: `AssessmentPeriods.created_by` defaults to `migration-032`,
  and rows carry that string.
- `migration-088a`: dismissed candidates carry
  `reviewed_by = 'migration-088-garage-departure-variance'` and a review note
  beginning `Dismissed by migration 088:`.

Console output (`PRINT`), error text (`THROW`) and comments describe the file
and are renamed with it.
