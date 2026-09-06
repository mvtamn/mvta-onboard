// The shape of one release. It lives in its own module because every file in
// changelog/ imports it, and changelogData.ts imports every file in
// changelog/ - putting the type beside the loader would make that a cycle.
export interface ChangelogSection {
  heading: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  sections: ChangelogSection[];
}
