import type { AdminIconName } from "./adminNav.js";

const paths: Record<AdminIconName | "search" | "chevron" | "chevronDown", string> = {
  shield: "M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 12h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2",
  clipboard: "M9 3h6v3H9zM7 4.5H5V21h14V4.5h-2M9 11h6M9 15h4",
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
  history: "M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 8v4l3 2",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4",
  chevron: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
};

export function AdminIcon({ name, size = 16 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}

// "⌘K" on a Mac, "Ctrl K" everywhere else: the shortcut accepts either key.
export function shortcutLabel(): string {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent;
  return /Mac|iPhone|iPad/i.test(platform) ? "⌘K" : "Ctrl K";
}
