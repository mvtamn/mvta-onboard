import { describe, expect, it } from "vitest";
import { CHANGELOG_ENTRIES } from "./changelogData.js";
// Imported through vite rather than node:fs: this package's tsconfig types are
// vite/client only, and reading the file with node:fs would mean giving the
// app's type environment Node globals it should not have.
import changelogMarkdown from "../../../../../CHANGELOG.md?raw";

// The newest entry is the console's version (vite.config.ts reads it), and
// CHANGELOG.md and changelogData.ts are hand-synced mirrors. Both facts used
// to rest on nobody making a mistake. Two branches still read the same main
// and so still pick the same next version; what changed is that the result is
// checked rather than assumed. Both duplicate versions that reached main
// would have failed here.
function order(version: string): number[] {
  return version.split(".").map((part) => Number(part));
}

function compare(a: string, b: string): number {
  const [left, right] = [order(a), order(b)];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

describe("changelog data", () => {
  it("gives every release a version of its own", () => {
    const versions = CHANGELOG_ENTRIES.map((entry) => entry.version);
    const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index);
    // Two branches picking the same next version is the failure this catches:
    // it used to merge silently, because both sides wrote the same line.
    expect(duplicates).toEqual([]);
  });

  it("lists releases newest first", () => {
    const outOfOrder = CHANGELOG_ENTRIES.flatMap((entry, index) => {
      const next = CHANGELOG_ENTRIES[index + 1];
      return next && compare(entry.version, next.version) <= 0 ? [`${entry.version} is not above ${next.version}`] : [];
    });
    expect(outOfOrder).toEqual([]);
  });

  it("uses a numeric version everywhere, since the newest one becomes the build version", () => {
    const malformed = CHANGELOG_ENTRIES.filter((entry) => !/^\d+(\.\d+)*$/.test(entry.version));
    expect(malformed.map((entry) => entry.version)).toEqual([]);
  });

  it("agrees with CHANGELOG.md about what the newest release is", () => {
    const markdown = changelogMarkdown;
    // Skip an [Unreleased] heading: changelogData deliberately mirrors
    // released versions only.
    const newest = markdown.match(/^## \[(\d+(?:\.\d+)*)\]/m)?.[1];
    expect(newest).toBe(CHANGELOG_ENTRIES[0]?.version);
  });
});
