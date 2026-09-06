// Structured mirror of the repo-root CHANGELOG.md's RELEASED versions only -
// deliberately excludes the [Unreleased] section, which carries internal/
// in-flight notes (some sensitive - e.g. unconfirmed live-environment
// security gaps) not appropriate for a general staff-facing release-notes
// page.
//
// One file per release under changelog/, rather than one array everyone edits.
// The array was an append-at-the-top list, so every branch inserted at the same
// line and two branches in the same release window always conflicted, whatever
// they had changed - eight consecutive pull requests did, none of them over
// code. Worse, main's own history carries a commit whose entire purpose was
// splitting two entries that had been merged into one. Separate files have no
// shared insertion point, so they merge without anyone having to arbitrate.
//
// See changelog/README.md for how to name a new one. Ordering comes from the
// version inside each file, never from the filename.
import type { ChangelogEntry } from "./changelogEntry.js";

export type { ChangelogEntry, ChangelogSection } from "./changelogEntry.js";

const modules = import.meta.glob<ChangelogEntry>("./changelog/*.ts", { eager: true, import: "default" });

function descending(a: ChangelogEntry, b: ChangelogEntry): number {
  const [left, right] = [a.version.split("."), b.version.split(".")];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = Number(right[index] ?? 0) - Number(left[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export const CHANGELOG_ENTRIES: ChangelogEntry[] = Object.values(modules).sort(descending);
