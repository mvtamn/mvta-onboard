// Performance Assessment redesign - artboard generator.
//
// Every screen shares the console shell (rail, top bar, tokens) and the module
// header. Rather than hand-copy that into thirteen files, this script composes
// each screen from shared fragments and writes the .dc.html artboards beside
// it. Edit here, run `node build.mjs`, then re-seed the canvas.
//
// Values are lifted from frontend/packages/onboard-console/src/styles.css,
// routes/modules/assessment/assessment.css and routes/performanceStandards.css.
// Sample data (contractor, figures, occurrences) is invented.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ icons */
const svg = (paths, size = 16, extra = "") =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${paths}</svg>`;
const I = {
  dashboard: (s) => svg('<rect x="3" y="3" width="7" height="9" rx="1.5"></rect><rect x="14" y="3" width="7" height="5" rx="1.5"></rect><rect x="14" y="12" width="7" height="9" rx="1.5"></rect><rect x="3" y="16" width="7" height="5" rx="1.5"></rect>', s),
  compose: (s) => svg('<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>', s),
  messages: (s) => svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>', s),
  bell: (s) => svg('<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>', s),
  users: (s) => svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>', s),
  clock: (s) => svg('<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 3"></path>', s),
  gear: (s) => svg('<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"></path>', s),
  wrench: (s) => svg('<path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L2 19l3 3 7.1-7.1a4 4 0 0 0 5.6-5.6l-2.8 2.8-2.1-2.1Z"></path>', s),
  bus: (s) => svg('<rect x="4" y="3" width="16" height="16" rx="3"></rect><path d="M4 9h16M8 19v2M16 19v2M8 15h.01M16 15h.01"></path>', s),
  menu: (s) => svg('<path d="M4 6h16M4 12h16M4 18h16"></path>', s),
  shield: (s) => svg('<path d="M12 2 4 5v6c0 5 3.4 8.4 8 11 4.6-2.6 8-6 8-11V5Z"></path><path d="m9 12 2 2 4-4"></path>', s),
  assessment: (s) => svg('<path d="M9 4h6"></path><path d="M9 2h6a2 2 0 0 1 2 2v1h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2V4a2 2 0 0 1 2-2Z"></path><path d="m7 12 2 2 4-4M7 18h10"></path>', s),
  detour: (s) => svg('<path d="M4 17h4l3-11 3 11h4"></path><path d="M17 13l3 4-3 4"></path>', s),
  sun: (s) => svg('<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>', s),
  chevronDown: (s) => svg('<path d="m6 9 6 6 6-6"></path>', s),
  chevronLeft: (s) => svg('<path d="m15 6-6 6 6 6"></path>', s),
  chevronRight: (s) => svg('<path d="m9 6 6 6-6 6"></path>', s),
  check: (s) => svg('<path d="m5 12 4 4L19 6"></path>', s, ' stroke-width="2.5"'),
  search: (s) => svg('<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>', s),
  upload: (s) => svg('<path d="M12 16V4M6 10l6-6 6 6"></path><path d="M4 20h16"></path>', s),
  external: (s) => svg('<path d="M14 4h6v6"></path><path d="M20 4 10 14"></path><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>', s),
  file: (s) => svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"></path><path d="M14 3v5h5"></path>', s),
  alert: (s) => svg('<path d="M12 9v4M12 17h.01"></path><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"></path>', s),
  dot: () => '<span class="pa-dot" aria-hidden="true"></span>',
};

/* ----------------------------------------------------------------- tokens */
const TOKENS = `
.pa-root {
  --page-bg: #edebe4; --surface-bg: #fff; --surface-alt-bg: #f6f5f1;
  --border: #ddd; --border-strong: #ccc; --border-soft: #eee;
  --text: #2c2c2a; --text-dim: #4f4f4f; --text-muted: #8a8a82;
  --brand-green: #00553d; --brand-green-hover: #003d2c; --brand-green-text: #00553d;
  --nav-bg: var(--brand-green);
  --danger-text: #8a1f1f; --success-text: #1f7a4c; --success-bg: #e3f0d4;
  --live-dot: #2fae66; --table-stripe: #fafaf8;
  --pill-warning-bg: #fcefd8; --pill-warning-fg: #7a4a00;
  --pill-danger-bg: #fbe0e0; --pill-danger-fg: #8a1f1f;
  --pill-accent-bg: #dceaf8; --pill-accent-fg: #0b4c82;
  --pill-success-bg: #e3f0d4; --pill-success-fg: #33530f;
  --pill-muted-bg: #ececea; --pill-muted-fg: #4f4f4f;
  --datasource-border: #d8e6dd;
  --chip-bg: #dcede6; --chip-fg: #00301f;
  --highlight-bg: #fdf1e1; --highlight-border: #faad60;
  --nav-item-fg: rgba(255,255,255,.85); --nav-item-fg-dim: rgba(255,255,255,.5);
  --nav-item-hover-bg: rgba(255,255,255,.08); --nav-item-active-bg: rgba(255,255,255,.14);
  --nav-border: rgba(255,255,255,.12);
  background: var(--page-bg); color: var(--text);
}
.pa-root[data-theme="dark"] {
  --page-bg: #0b120e; --surface-bg: #152219; --surface-alt-bg: #16241d;
  --border: #25392f; --border-strong: #2e4238; --border-soft: #1c2a23;
  --text: #eef3f0; --text-dim: #c7d2cc; --text-muted: #8aa096;
  --brand-green-text: #6fc9a0; --danger-text: #f0a1a1; --success-text: #7fd3a4; --success-bg: #1d3a2b;
  --table-stripe: #182619;
  --pill-warning-bg: #3a2c12; --pill-warning-fg: #f3c77a;
  --pill-danger-bg: #3d1b1b; --pill-danger-fg: #f0a1a1;
  --pill-accent-bg: #16304a; --pill-accent-fg: #9cc7ee;
  --pill-success-bg: #1d3a2b; --pill-success-fg: #b6e2c4;
  --pill-muted-bg: #263429; --pill-muted-fg: #c7d2cc;
  --datasource-border: #2e4238; --chip-bg: #1f3a2d; --chip-fg: #cfe9db;
  --highlight-bg: #3a2a14; --highlight-border: #b97a2c;
}`;

/* ------------------------------------------------------------------ shell */
const SHELL = `
body { margin: 0; font-family: -apple-system, "Segoe UI", Inter, Roboto, Arial, sans-serif; font-size: 13px; }
a { color: #00553d; text-decoration: none; } a:hover { color: #003d2c; text-decoration: underline; }
* { box-sizing: border-box; }
.pa-root { padding: 24px; min-height: 100vh; width: 1440px; }
.pa-root a { color: var(--brand-green-text); }
.frame { background: var(--surface-bg); border-radius: 14px; overflow: hidden; border: 1px solid var(--border); box-shadow: 0 4px 16px rgba(0,0,0,.1); display: flex; }
.nav-sidebar { width: 232px; flex-shrink: 0; background: var(--nav-bg); display: flex; flex-direction: column; padding: 18px 14px; }
.nav-brand { display: flex; align-items: center; gap: 10px; padding: 6px 8px 22px; }
.logo-badge { background: rgba(255,255,255,.15); color: #fff; font-weight: bold; font-size: 12px; padding: 5px 9px; border-radius: 6px; letter-spacing: .5px; }
.nav-brand-text { color: #fff; font-weight: bold; font-size: 15px; line-height: 1.2; }
.nav-brand-sub { color: var(--nav-item-fg-dim); font-size: 11px; margin-top: 1px; }
.nav-collapse-btn { margin-left: auto; background: transparent; border: 0; color: var(--nav-item-fg-dim); display: flex; padding: 4px; border-radius: 6px; }
.nav-list { display: flex; flex-direction: column; gap: 2px; }
.nav-group { border-top: 1px solid rgba(255,255,255,.13); margin-top: 8px; padding-top: 6px; }
.nav-group:first-child { border-top: 0; margin-top: 0; padding-top: 0; }
.nav-group-toggle { display: flex; align-items: center; justify-content: space-between; color: var(--nav-item-fg-dim); font-size: 10.5px; font-weight: 800; letter-spacing: .07em; padding: 8px 12px 6px; text-transform: uppercase; }
.nav-group-toggle svg { width: 13px; height: 13px; opacity: .8; }
.nav-group-links { display: flex; flex-direction: column; gap: 2px; }
.nav-item { position: relative; }
.nav-list a { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 7px; color: var(--nav-item-fg); font-size: 13.5px; font-weight: 500; position: relative; text-decoration: none; }
.nav-list a svg { width: 16px; height: 16px; flex-shrink: 0; opacity: .85; }
.nav-list a.active { background: var(--nav-item-active-bg); color: #fff; font-weight: 600; }
.nav-list a.active svg { opacity: 1; }
.nav-list a.active::before { background: var(--live-dot); border-radius: 0 3px 3px 0; content: ""; height: 17px; left: -14px; position: absolute; top: 50%; transform: translateY(-50%); width: 3px; }
.nav-spacer { flex: 1; }
.nav-footer { border-top: 1px solid var(--nav-border); display: flex; flex-direction: column; gap: 6px; margin-top: 10px; padding-top: 12px; }
.nav-status { display: flex; align-items: center; gap: 7px; padding: 4px 12px; color: var(--nav-item-fg-dim); font-size: 11.5px; font-weight: 600; }
.live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--live-dot); display: inline-block; }
.nav-changelog { align-items: center; background: rgba(255,255,255,.06); border: 1px solid var(--nav-border); border-radius: 9px; color: var(--nav-item-fg); display: flex; gap: 9px; padding: 9px 11px; }
.nav-version-number { background: rgba(255,255,255,.16); border-radius: 999px; color: #fff; flex-shrink: 0; font-size: 10px; font-weight: 800; padding: 3px 7px; }
.nav-changelog-text { display: flex; flex-direction: column; line-height: 1.25; }
.nav-changelog-text b { font-size: 12px; font-weight: 600; white-space: nowrap; }
.nav-changelog-text small { color: var(--nav-item-fg-dim); font-size: 10px; }
.nav-changelog-arrow { display: flex; margin-left: auto; opacity: .55; }
.content-col { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.content-topbar { background: var(--surface-bg); border-bottom: 1px solid var(--border); padding: 14px 22px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.content-topbar h1 { font-size: 22px; font-weight: 800; color: var(--text); margin: 0; letter-spacing: -.01em; }
.content-topbar .subtitle { color: var(--text-muted); font-size: 12.5px; margin-top: 3px; }
.topbar-actions { display: flex; align-items: center; gap: 10px; }
.theme-toggle-btn { width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border-strong); background: var(--surface-bg); color: var(--text); display: flex; align-items: center; justify-content: center; }
.pill-user { display: flex; align-items: center; gap: 8px; background: var(--surface-alt-bg); border: 1px solid var(--border); color: var(--text); font-size: 12px; padding: 4px 12px 4px 4px; border-radius: 999px; }
.avatar { width: 24px; height: 24px; border-radius: 50%; background: var(--brand-green); color: #fff; font-size: 10.5px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.content-main { flex: 1; padding: 20px 22px; }
.panel-header { background: var(--brand-green); color: #fff; padding: 12px 18px; border-radius: 10px 10px 0 0; font-size: 14.5px; font-weight: bold; display: flex; justify-content: space-between; align-items: center; text-transform: uppercase; }
.panel-header a { color: rgba(255,255,255,.85); font-size: 11.5px; font-weight: 700; text-transform: none; display: inline-flex; align-items: center; gap: 6px; }
.panel-body { border: 1px solid var(--border); border-top: none; border-radius: 0 0 10px 10px; padding: 16px 18px; background: var(--surface-bg); box-shadow: 0 2px 8px rgba(0,0,0,.04); }
table.data { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
table.data th { background: var(--brand-green); color: #fff; text-align: left; padding: 9px 12px; font-size: 11px; letter-spacing: .3px; font-weight: 700; }
table.data th:first-child { border-top-left-radius: 8px; } table.data th:last-child { border-top-right-radius: 8px; }
table.data td { padding: 9px 12px; border-bottom: 1px solid var(--border-soft); color: var(--text); vertical-align: top; }
table.data td small { display: block; color: var(--text-muted); font-size: 11px; margin-top: 2px; }
table.data tr.route-group-header td { background: var(--surface-alt-bg); color: var(--text); font-weight: bold; font-size: 12px; border-bottom: 1px solid var(--border-strong); padding-top: 10px; }
table.data th.num, table.data td.num { text-align: right; }
.pill-sm { font-size: 10.5px; font-weight: bold; padding: 3px 8px; border-radius: 10px; white-space: nowrap; display: inline-block; line-height: 1.3; }
.pill-warning { background: var(--pill-warning-bg); color: var(--pill-warning-fg); }
.pill-danger { background: var(--pill-danger-bg); color: var(--pill-danger-fg); }
.pill-accent { background: var(--pill-accent-bg); color: var(--pill-accent-fg); }
.pill-success { background: var(--pill-success-bg); color: var(--pill-success-fg); }
.pill-muted { background: var(--pill-muted-bg); color: var(--pill-muted-fg); }
.chip { background: var(--chip-bg); color: var(--chip-fg); font-size: 11px; padding: 3px 9px; border-radius: 16px; display: inline-block; }
.btn-primary { background: var(--brand-green); color: #fff; border: none; border-radius: 8px; padding: 10px 18px; font-weight: bold; font-size: 13px; display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.btn-primary[disabled] { opacity: .6; }
.btn-sm { font-size: 11px; padding: 5px 11px; border: 1px solid var(--border-strong); border-radius: 7px; background: var(--surface-bg); color: var(--text); display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-weight: 600; }
.btn-sm[disabled] { opacity: .45; }
.btn-sm.danger { border-color: var(--danger-text); color: var(--danger-text); }
.mono-ref { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 11px; color: var(--text-muted); }
.muted { color: var(--text-muted); }
.f { padding: 8px 10px; border: 1px solid var(--border-strong); border-radius: 8px; font-size: 12.5px; font-family: inherit; background: var(--surface-bg); color: var(--text); min-height: 36px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.f.placeholder { color: var(--text-muted); }
.pa-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); display: inline-block; flex: none; }
`;

/* ----------------------------------------------------------------- module */
const MODULE = `
.pa-module { display: grid; gap: 16px; }
.pa-glance { border: 1px solid var(--datasource-border); border-radius: 12px; background: var(--surface-alt-bg); padding: 16px 18px; display: grid; gap: 14px; }
.pa-glance-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.pa-identity { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.pa-picker { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface-bg); padding: 6px 8px 6px 12px; font: inherit; font-size: 17px; font-weight: 700; color: var(--text); }
.pa-picker svg { color: var(--text-muted); }
.pa-month { display: inline-flex; align-items: center; gap: 4px; }
.pa-month strong { font-size: 17px; font-weight: 700; min-width: 150px; text-align: center; }
.pa-step-btn { width: 30px; height: 30px; border-radius: 7px; border: 1px solid var(--border-strong); background: var(--surface-bg); color: var(--text-dim); display: inline-flex; align-items: center; justify-content: center; }
.pa-glance-meta { color: var(--text-muted); font-size: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: -6px; }
.pa-glance-bottom { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 24px; align-items: start; border-top: 1px solid var(--border); padding-top: 14px; }
.pa-lifecycle { list-style: none; margin: 0; padding: 0; display: flex; align-items: flex-start; }
.pa-lifecycle li { display: grid; justify-items: center; gap: 7px; flex: 1; position: relative; min-width: 0; }
.pa-lifecycle li::before { content: ""; position: absolute; top: 10px; left: -50%; right: 50%; height: 2px; background: var(--border-strong); }
.pa-lifecycle li:first-child::before { display: none; }
.pa-lifecycle li.done::before { background: var(--brand-green); }
.pa-lifecycle li.current::before { background: var(--brand-green); }
.pa-lifecycle .pa-node { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--border-strong); background: var(--surface-bg); display: flex; align-items: center; justify-content: center; position: relative; z-index: 1; }
.pa-lifecycle li.done .pa-node { background: var(--brand-green); border-color: var(--brand-green); color: #fff; }
.pa-lifecycle li.current .pa-node { border-color: var(--brand-green); box-shadow: 0 0 0 4px var(--chip-bg); }
.pa-lifecycle li.current .pa-node::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--brand-green); }
.pa-lifecycle span { font-size: 11.5px; color: var(--text-muted); text-align: center; line-height: 1.25; }
.pa-lifecycle li.done span { color: var(--text-dim); }
.pa-lifecycle li.current span { color: var(--text); font-weight: 700; }
.pa-lifecycle small { font-size: 10.5px; color: var(--text-muted); display: block; font-weight: 400; margin-top: 1px; }
.pa-figures { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 22px; }
.pa-outstanding a { white-space: nowrap; }
.pa-figures > div > span { display: block; color: var(--text-muted); font-size: 11px; }
.pa-figures strong { display: block; color: var(--text); font-size: 22px; line-height: 1.2; margin: 3px 0; font-weight: 800; letter-spacing: -.01em; }
.pa-figures small { display: block; color: var(--text-muted); font-size: 11px; }
.pa-outstanding { display: grid; gap: 4px; align-content: start; }
.pa-outstanding a { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; color: var(--text-dim); line-height: 1.5; }
.pa-outstanding a .pa-dot { background: var(--highlight-border); }
.pa-outstanding a.quiet .pa-dot { background: var(--text-muted); }
.pa-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--border); padding-bottom: 10px; }
.pa-tab { display: inline-flex; align-items: center; gap: 7px; border: 1px solid transparent; border-radius: 8px; background: var(--surface-alt-bg); padding: 7px 12px; color: var(--text-dim); font: inherit; font-size: 13px; font-weight: 600; }
.pa-tab.active { background: var(--brand-green); border-color: var(--brand-green); color: #fff; font-weight: 700; }
.pa-tab .pa-count { font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 999px; background: var(--pill-muted-bg); color: var(--text-dim); line-height: 1.4; }
.pa-tab.active .pa-count { background: rgba(255,255,255,.22); color: #fff; }
.pa-tab .pa-count.hot { background: var(--pill-warning-bg); color: var(--pill-warning-fg); }
.pa-tab.active .pa-count.hot { background: #fff; color: var(--brand-green); }
.pa-tabs .pa-tabs-spacer { flex: 1; }
.pa-tabs .pa-catalog-link { align-self: center; font-size: 12px; font-weight: 600; display: inline-flex; gap: 6px; align-items: center; color: var(--text-muted); }
.pa-section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.pa-section-head h3 { margin: 0; font-size: 16px; font-weight: 700; }
.pa-section-head p { margin: 4px 0 0; color: var(--text-muted); font-size: 12.5px; max-width: 72ch; }
.pa-section-actions { display: flex; gap: 8px; align-items: center; flex: none; }
.pa-table-wrap { border: 1px solid var(--border); border-radius: 10px; overflow: auto; }
.pa-table-wrap table.data th:first-child, .pa-table-wrap table.data th:last-child { border-radius: 0; }
table.data tr.pa-total td { background: var(--surface-alt-bg); font-weight: 700; border-bottom: 0; border-top: 1px solid var(--border-strong); }
.pa-row-chevron { color: var(--text-muted); text-align: right; width: 32px; }
.pa-tier { border-radius: 999px; padding: 3px 9px; font-size: 10.5px; font-weight: 700; white-space: nowrap; display: inline-block; line-height: 1.3; }
.pa-tier.meets { background: var(--pill-success-bg); color: var(--pill-success-fg); }
.pa-tier.warning { background: var(--pill-warning-bg); color: var(--pill-warning-fg); }
.pa-tier.tier1 { background: var(--highlight-bg); color: #8a4a00; }
.pa-root[data-theme="dark"] .pa-tier.tier1 { color: #f3c77a; }
.pa-tier.tier2 { background: var(--pill-danger-bg); color: var(--pill-danger-fg); }
.pa-tier.na { background: var(--pill-muted-bg); color: var(--pill-muted-fg); }
.pa-notice { display: flex; gap: 10px; align-items: flex-start; padding: 10px 14px; border-radius: 9px; background: var(--highlight-bg); border: 1px solid var(--highlight-border); color: var(--text); font-size: 12.5px; }
.pa-notice svg { color: #8a4a00; flex: none; margin-top: 1px; }
.pa-notice a { font-weight: 700; }
.pa-empty { padding: 32px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border-strong); border-radius: 10px; background: var(--surface-alt-bg); font-size: 12.5px; }
.pa-empty strong { display: block; color: var(--text); margin-bottom: 4px; }
.pa-card { border: 1px solid var(--border); border-radius: 10px; background: var(--surface-bg); padding: 14px 16px; }
.pa-card h4 { margin: 0 0 4px; font-size: 13px; font-weight: 700; }
.pa-card p { margin: 0; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.pa-crumb { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: var(--text-dim); }
.pa-detail { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; align-items: start; }
.pa-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.pa-detail-head h3 { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -.01em; }
.pa-detail-head p { margin: 5px 0 0; color: var(--text-muted); font-size: 12.5px; }
.pa-calc { display: flex; align-items: center; gap: 14px; padding: 14px 16px; background: var(--surface-alt-bg); border: 1px solid var(--border); border-radius: 10px; }
.pa-calc > div { display: grid; gap: 2px; }
.pa-calc > div > span { color: var(--text-muted); font-size: 11px; }
.pa-calc > div > strong { font-size: 18px; font-weight: 800; }
.pa-calc > b { color: var(--text-muted); font-size: 16px; font-weight: 500; }
.pa-calc > div.result { margin-left: auto; text-align: right; padding-left: 16px; border-left: 1px solid var(--border-strong); }
.pa-calc > div.result strong { font-size: 22px; color: var(--brand-green-text); }
.pa-kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; font-size: 12px; margin: 0; }
.pa-kv dt { color: var(--text-muted); } .pa-kv dd { margin: 0; color: var(--text); font-weight: 600; }
.pa-stack { display: grid; gap: 14px; }
.pa-actions-col { display: grid; gap: 8px; }
.pa-actions-col .btn-sm, .pa-actions-col .btn-primary { justify-content: center; width: 100%; padding-top: 9px; padding-bottom: 9px; font-size: 12px; }
.pa-evidence li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--border-soft); font-size: 12px; }
.pa-evidence li:first-child { border-top: 0; }
.pa-evidence svg { color: var(--text-muted); flex: none; }
.pa-evidence .grow { flex: 1; min-width: 0; } .pa-evidence .grow small { display: block; color: var(--text-muted); font-size: 11px; }
.pa-evidence ul { list-style: none; margin: 6px 0 0; padding: 0; }
.pa-filters { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.pa-segmented { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 8px; overflow: hidden; background: var(--surface-bg); }
.pa-segmented button { border: 0; background: transparent; padding: 7px 12px; font: inherit; font-size: 12px; font-weight: 600; color: var(--text-dim); display: inline-flex; gap: 6px; align-items: center; border-left: 1px solid var(--border-soft); }
.pa-segmented button:first-child { border-left: 0; }
.pa-segmented button.active { background: var(--chip-bg); color: var(--chip-fg); }
.pa-segmented button b { font-weight: 800; font-size: 10.5px; color: var(--text-muted); }
.pa-search { min-width: 240px; }
.pa-obs { display: block; white-space: nowrap; } .pa-obs a { font-weight: 600; }
.pa-status-cell { display: grid; gap: 3px; justify-items: start; } .pa-status-cell small { margin: 0; }
.pa-metric-row { display: grid; grid-template-columns: minmax(0, 1.3fr) 130px minmax(0, 1.4fr) 150px 110px; gap: 12px; align-items: center; padding: 12px 14px; border-top: 1px solid var(--border-soft); }
.pa-metric-row:first-child { border-top: 0; }
.pa-metric-row strong { display: block; font-size: 13px; } .pa-metric-row small { display: block; color: var(--text-muted); font-size: 11px; margin-top: 2px; }
.pa-metric-row .f { min-height: 34px; padding: 6px 10px; font-size: 12.5px; }
.pa-metric-row .f.unit { justify-content: flex-start; }
.pa-metric-row .f.unit span { margin-left: auto; color: var(--text-muted); font-size: 11px; }
.pa-metric-head { display: grid; grid-template-columns: minmax(0, 1.3fr) 130px minmax(0, 1.4fr) 150px 110px; gap: 12px; padding: 8px 14px; background: var(--surface-alt-bg); border-bottom: 1px solid var(--border-soft); color: var(--text-dim); font-size: 11px; font-weight: 700; }
.pa-progress { height: 6px; border-radius: 999px; background: var(--pill-muted-bg); overflow: hidden; }
.pa-progress i { display: block; height: 100%; background: var(--brand-green); border-radius: 999px; }
.pa-review-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 12px 14px; border-top: 1px solid var(--border-soft); }
.pa-review-row:first-child { border-top: 0; }
.pa-review-row strong { display: block; font-size: 13px; } .pa-review-row small { display: block; color: var(--text-muted); font-size: 11.5px; margin-top: 2px; }
.pa-review-row .pa-review-actions { display: flex; gap: 6px; }
.pa-review-row .pa-decision { display: flex; align-items: center; gap: 10px; }
.pa-review-row .pa-decision small { margin: 0; }
.pa-group-label { color: var(--text-muted); font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; margin: 0; }
.pa-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.pa-step-card { border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; background: var(--surface-bg); display: grid; gap: 10px; align-content: start; position: relative; }
.pa-step-card.current { border-color: var(--brand-green); box-shadow: inset 0 0 0 1px var(--brand-green); }
.pa-step-card.locked { background: var(--surface-alt-bg); }
.pa-step-card .pa-step-no { width: 24px; height: 24px; border-radius: 50%; background: var(--chip-bg); color: var(--chip-fg); font-size: 11.5px; font-weight: 800; display: inline-flex; align-items: center; justify-content: center; }
.pa-step-card.locked .pa-step-no { background: var(--pill-muted-bg); color: var(--text-muted); }
.pa-step-card h4 { margin: 0; font-size: 13.5px; } .pa-step-card p { margin: 0; color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.pa-step-card .pa-step-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.pa-step-card .pa-step-state { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-dim); }
`;

/* ------------------------------------------------------------ admin extras */
const ADMIN = `
.admin-layout { display: grid; grid-template-columns: 218px minmax(0, 1fr); gap: 18px; align-items: start; }
.admin-secondary-nav { background: var(--surface-bg); border: 1px solid var(--border); border-radius: 12px; padding: 14px 10px; }
.admin-secondary-heading { display: grid; gap: 4px; padding: 8px 10px 16px; border-bottom: 1px solid var(--border-soft); }
.admin-secondary-heading strong { font-size: 17px; }
.admin-eyebrow { color: var(--brand-green-text); font-size: 10px; font-weight: 800; letter-spacing: .08em; }
.admin-secondary-links { display: grid; gap: 3px; padding-top: 10px; }
.admin-secondary-links a { display: flex; align-items: center; gap: 9px; padding: 9px 10px; color: var(--text-dim); text-decoration: none; border-radius: 7px; font-weight: 600; }
.admin-secondary-links a.active { background: var(--chip-bg); color: var(--brand-green-text); }
.admin-secondary-links svg { width: 16px; height: 16px; flex-shrink: 0; }
.admin-secondary-group { display: grid; gap: 3px; margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--border-soft); }
.admin-secondary-group-label { color: var(--text-muted); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; padding: 4px 10px 6px; }
.admin-secondary-group a { padding-left: 18px; }
.admin-layout-content { min-width: 0; }
.standards-page { display: grid; gap: 16px; }
.standards-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.standards-head p { margin: 0; color: var(--text-muted); max-width: 78ch; font-size: 12.5px; line-height: 1.5; }
.assessment-eyebrow { display: block; color: var(--brand-green-text); font-size: 11px; font-weight: 800; letter-spacing: .08em; margin-bottom: 4px; }
.standards-workspace { display: grid; gap: 14px; align-items: start; grid-template-columns: minmax(300px, .85fr) minmax(420px, 1.15fr); }
.standards-list, .standards-detail { background: var(--surface-bg); border: 1px solid var(--border); border-radius: 11px; box-shadow: 0 2px 8px rgba(0,0,0,.04); min-width: 0; overflow: hidden; display: grid; align-content: start; }
.standards-list-toolbar { display: flex; gap: 8px; padding: 12px; border-bottom: 1px solid var(--border-soft); }
.standards-list-toolbar .f { flex: 1 1 auto; }
.standards-list-toolbar .f.narrow { flex: 0 0 150px; }
.standards-list-meta { padding: 8px 12px; color: var(--text-muted); font-size: 11.5px; border-bottom: 1px solid var(--border-soft); display: flex; justify-content: space-between; align-items: center; }
.standards-rows { list-style: none; margin: 0; padding: 6px; display: grid; gap: 2px; align-content: start; }
.standards-group { list-style: none; color: var(--text-muted); font-size: 10.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; padding: 10px 10px 4px; }
.standards-row { width: 100%; display: grid; gap: 4px; text-align: left; border: 1px solid transparent; border-radius: 9px; background: transparent; padding: 9px 10px; font: inherit; color: inherit; }
.standards-row.selected { background: var(--chip-bg); border-color: var(--brand-green); }
.standards-row-name { display: grid; gap: 2px; }
.standards-row-name strong { font-size: 13px; line-height: 1.25; }
.standards-row-description { color: var(--text-dim); font-size: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4; }
.standards-row-description.is-empty { color: var(--text-muted); font-style: italic; }
.standards-row-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.standards-row-meta small { color: var(--text-muted); font-size: 11px; }
.standards-state { border-radius: 999px; padding: 2px 8px; font-size: 10px; font-weight: 700; }
.standards-state.scored { background: var(--pill-success-bg); color: var(--pill-success-fg); }
.standards-state.dormant { background: var(--pill-warning-bg); color: var(--pill-warning-fg); }
.standards-state.unassigned { background: var(--pill-muted-bg); color: var(--text-dim); }
.standards-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--border-soft); }
.standards-detail-head h3 { margin: 0; font-size: 16px; }
.standards-detail-actions { display: flex; gap: 8px; flex: none; }
.standards-tabs { display: flex; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--border-soft); }
.standards-tabs button { white-space: nowrap; border: 1px solid transparent; border-radius: 8px; background: var(--surface-alt-bg); padding: 7px 12px; color: var(--text-dim); font: inherit; font-weight: 600; }
.standards-tabs button.active { background: var(--brand-green); border-color: var(--brand-green); color: #fff; font-weight: 700; }
.standards-tab-body { padding: 16px; display: grid; gap: 16px; }
.standards-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: start; }
.standards-grid label, .standards-band label { display: grid; gap: 6px; }
.standards-grid label > span, .standards-band label > span, .standards-fieldset legend { color: var(--text-dim); font-size: 11.5px; font-weight: 700; }
.standards-grid .f, .standards-band .f { min-height: 40px; }
.standards-grid small { color: var(--text-muted); font-size: 11px; line-height: 1.4; }
.standards-wide { grid-column: 1 / -1; }
.standards-fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 10px; }
.standards-fieldset legend { padding: 0; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .05em; font-size: 10.5px; color: var(--text-muted); }
.contractor-active { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.contractor-active .box { width: 18px; height: 18px; border-radius: 4px; border: 1px solid var(--border-strong); background: var(--surface-bg); display: inline-flex; align-items: center; justify-content: center; }
.contractor-active .box.on { background: var(--brand-green); border-color: var(--brand-green); color: #fff; }
.standards-hint { color: var(--text-muted); font-size: 12px; line-height: 1.5; }
.standards-agreement-bar { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border: 1px solid var(--datasource-border); border-radius: 10px; background: var(--surface-alt-bg); }
.standards-agreement-bar > span.label { color: var(--brand-green-text); font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; flex: none; }
.standards-agreement-bar .f { flex: 1 1 260px; }
.standards-exhibit { padding: 3px 9px; border-radius: 10px; background: var(--chip-bg); color: var(--chip-fg); font-size: 11px; font-weight: 700; flex: none; }
.standards-bands { display: grid; gap: 12px; }
.standards-band { border: 1px solid var(--border); border-radius: 11px; background: var(--surface-alt-bg); padding: 14px; display: grid; gap: 12px; }
.standards-band-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.standards-band-head .pa-tier { text-transform: none; }
.standards-band-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: end; }
.standards-measure { display: flex; align-items: center; gap: 6px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface-bg); padding: 0 10px; min-height: 38px; font-size: 12.5px; }
.standards-measure span { color: var(--text-muted); font-size: 11.5px; font-weight: 600; white-space: nowrap; margin-left: auto; }
.standards-band-readout { margin: 0; padding: 9px 12px; border-radius: 8px; background: var(--chip-bg); color: var(--chip-fg); font-size: 12.5px; font-weight: 600; }
.standards-band-list { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 4px; }
.standards-band-list li { display: flex; align-items: baseline; gap: 7px; font-size: 12px; color: var(--text-dim); }
.standards-target { display: block; margin-top: 6px; color: var(--text-muted); font-size: 11.5px; font-weight: 600; }
.standards-tier-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.standards-new-value { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto; gap: 10px; align-items: end; }
.standards-new-value label { display: grid; gap: 5px; }
.standards-new-value span { color: var(--text-dim); font-size: 11.5px; font-weight: 700; }
.standards-toggle { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; font-size: 12px; }
.lists-rows .standards-row { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
.lists-rows .standards-row small { color: var(--text-muted); font-size: 11px; }
.lists-rows .standards-row .count { color: var(--text-muted); font-size: 11px; font-weight: 700; }
.lists-rows .standards-row.selected .count { color: var(--chip-fg); }
.agreement-summary { display: grid; gap: 8px; }
.lists-table td:first-child { min-width: 210px; } .lists-table th:last-child, .lists-table td:last-child, .lists-table td:nth-child(5) { white-space: nowrap; } .lists-table td:nth-child(2) { white-space: nowrap; }
.agreement-summary .pa-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; }
`;

/* ------------------------------------------------------------- fragments */
function rail(active) {
  const link = (key, label, icon) => `<div class="nav-item"><a class="${active === key ? "active" : ""}">${icon}<span>${label}</span></a></div>`;
  const group = (name, links) => `<section class="nav-group"><div class="nav-group-toggle"><span>${name}</span>${I.chevronDown()}</div><div class="nav-group-links">${links.join("")}</div></section>`;
  return `<aside class="nav-sidebar">
  <div class="nav-brand"><span class="logo-badge">MVTA</span><div><div class="nav-brand-text">OnBoard</div><div class="nav-brand-sub">Staff console</div></div><span class="nav-collapse-btn">${I.menu(16)}</span></div>
  <nav class="nav-list">
    ${group("Service Operations", [
      link("dashboard", "Dashboard", I.dashboard()), link("overview", "Overview", I.messages()), link("compose", "Compose", I.compose()),
      link("active", "Active Service Alerts", I.bell()), link("suggested", "Suggested Alerts", I.bell()), link("risk", "Service Risk &amp; Quality", I.shield()), link("dispatch", "Dispatch Log", I.clock()),
    ])}
    ${group("Specialist Operations", [link("detours", "Detours &amp; Closures", I.detour()), link("intake", "Detour Intake", I.detour()), link("reports", "Detour Reports", I.clock()), link("occ", "OCC Tools", I.wrench())])}
    ${group("Events", [link("planning", "Planning", I.bus()), link("avl", "Event AVL", I.bus())])}
    ${group("Compliance &amp; Assessment", [link("compliance", "Compliance", I.shield()), link("assessment", "Performance Assessment", I.assessment())])}
    ${group("Administration", [
      link("access", "Access &amp; Identity", I.shield()), link("events-admin", "Event Administration", I.bus()), link("service", "Service Configuration", I.wrench()),
      link("integrations", "Integrations &amp; Data Health", I.wrench()), link("matrix", "Decision Matrix", I.wrench()), link("otp", "OTP Compliance", I.wrench()),
      link("perf-setup", "Performance Setup", I.assessment()), link("governance", "Governance &amp; Audit", I.clock()),
    ])}
  </nav>
  <div class="nav-spacer"></div>
  <div class="nav-footer">
    <div class="nav-status"><span class="live-dot"></span><span>Console Live</span></div>
    <div class="nav-changelog"><span class="nav-version-number">v1.5.159</span><span class="nav-changelog-text"><b>What’s new</b><small>Release notes</small></span><span class="nav-changelog-arrow">${I.chevronDown(14)}</span></div>
  </div>
</aside>`;
}

function topbar(title, sub) {
  return `<header class="content-topbar"><div><h1>${title}</h1><div class="subtitle">${sub}</div></div><div class="topbar-actions"><span class="theme-toggle-btn">${I.sun(15)}</span><span class="pill-user"><span class="avatar">TF</span><span>Tyre Fant · OCC.Admin</span></span></div></header>`;
}

function page({ title, active, topTitle, topSub, main, frameHeight, admin = false }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <title>${title}</title>
  <style>${TOKENS}${SHELL}${MODULE}${admin ? ADMIN : ""}</style>
</helmet>
<div class="pa-root" data-theme="{{theme}}">
  <div class="frame" style="min-height: ${frameHeight}px">
    ${rail(active)}
    <div class="content-col">
      ${topbar(topTitle, topSub)}
      <main class="content-main">${main}</main>
    </div>
  </div>
</div>
</x-dc>
<script data-dc-script data-props='{"theme":{"editor":"enum","options":["light","dark"],"default":"light","section":"Console theme"},"$preview":{"width":1440,"height":${frameHeight + 48}}}'>
class Component extends DCLogic {
  renderVals() { return { theme: this.props.theme ?? "light" }; }
}
</script>
</body>
</html>
`;
}

/* -------------------------------------------------- module: shared header */
const MODULE_TOP = { title: "Performance Assessment", sub: "Monthly performance standards scoring, evidence, review, and issuance" };

function lifecycle(current = 3) {
  const steps = [["Opened", "Sep 1"], ["Computed", "Sep 3 · rev 4"], ["In review", "3 items left"], ["Validation", "5 business days"], ["Finalized", ""], ["Issued", ""]];
  return `<ol class="pa-lifecycle">${steps.map(([label, sub], i) => {
    const cls = i + 1 < current ? "done" : i + 1 === current ? "current" : "";
    const inner = cls === "done" ? I.check(12) : "";
    return `<li class="${cls}"><span class="pa-node">${inner}</span><span>${label}${sub ? `<small>${sub}</small>` : ""}</span></li>`;
  }).join("")}</ol>`;
}

function glance({ status = "In review", pill = "pill-warning", action = "Continue review", current = 3 } = {}) {
  return `<section class="pa-glance" aria-label="Assessment month at a glance">
  <div class="pa-glance-top">
    <div class="pa-identity">
      <span class="pa-picker"><span>Northline Transit Services</span>${I.chevronDown(14)}</span>
      <span class="pa-month"><span class="pa-step-btn">${I.chevronLeft(14)}</span><strong>August 2026</strong><span class="pa-step-btn">${I.chevronRight(14)}</span></span>
      <span class="pill-sm ${pill}">${status}</span>
    </div>
    <span class="btn-primary">${action}${I.chevronRight(14)}</span>
  </div>
  <div class="pa-glance-meta"><span>Agreement RFP 2025-07</span>${I.dot()}<span>Attachment G v2</span>${I.dot()}<span>11 standards scored</span>${I.dot()}<span>Computed Sep 3, 10:42 from input revision 4</span></div>
  <div class="pa-glance-bottom">
    ${lifecycle(current)}
    <div class="pa-figures">
      <div><span>Proposed penalties</span><strong>$13,400</strong><small>Automation, before review</small></div>
      <div><span>Recommended so far</span><strong>$750</strong><small>6 of 11 items reviewed</small></div>
      <div class="pa-outstanding"><span style="color: var(--text-muted); font-size: 11px">Outstanding</span>
        <a>${I.dot()}3 items awaiting review · $10,900</a>
        <a>${I.dot()}2 monthly figures missing</a>
        <a>${I.dot()}1 occurrence needs an amount</a>
        <a class="quiet">${I.dot()}2 CAPs flagged</a>
      </div>
    </div>
  </div>
</section>`;
}

function tabs(active) {
  const t = [["scorecard", "Scorecard", ""], ["occurrences", "Occurrences", '<span class="pa-count">31</span>'], ["metrics", "Monthly metrics", '<span class="pa-count hot">2 missing</span>'], ["review", "Review", '<span class="pa-count hot">3</span>'], ["caps", "CAPs", '<span class="pa-count">2</span>'], ["issuance", "Issuance", ""]];
  return `<nav class="pa-tabs" aria-label="Assessment sections">${t.map(([k, l, c]) => `<span class="pa-tab ${active === k ? "active" : ""}">${l}${c}</span>`).join("")}<span class="pa-tabs-spacer"></span><a class="pa-catalog-link">Standards catalog ${I.external(13)}</a></nav>`;
}

function moduleShell(tab, body, frameHeight, glanceOpts) {
  return page({
    title: "Performance Assessment", active: "assessment", topTitle: MODULE_TOP.title, topSub: MODULE_TOP.sub, frameHeight,
    main: `<div class="panel-header"><span>Performance Assessment</span></div>
<div class="panel-body"><div class="pa-module">
${glance(glanceOpts)}
${tabs(tab)}
${body}
</div></div>`,
  });
}

const tier = (k, label) => `<span class="pa-tier ${k}">${label}</span>`;
const pill = (k, label) => `<span class="pill-sm ${k}">${label}</span>`;

/* -------------------------------------------------------------- scorecard */
function scorecardBody() {
  const group = (name, blurb) => `<tr class="route-group-header"><td colspan="7">${name} <span class="muted" style="font-weight: 400">· ${blurb}</span></td></tr>`;
  const row = (name, code, prio, result, target, outcome, occ, proposed, review) =>
    `<tr><td><strong>${name}</strong><small>${code} · ${prio}</small></td><td>${result}<small>${target}</small></td><td>${outcome}</td><td class="num">${occ}</td><td class="num">${proposed}</td><td>${review}</td><td class="pa-row-chevron">${I.chevronRight(14)}</td></tr>`;
  return `<section class="pa-stack">
<div class="pa-section-head"><div><h3>Scorecard</h3><p>Every standard scored in this Agreement, grouped the way the contract reads. Select a standard to see how its figure was produced, the observations behind it, and its evidence.</p></div><div class="pa-section-actions"><span class="btn-sm">${I.file(13)} Export scorecard</span></div></div>
<div class="pa-table-wrap"><table class="data">
<thead><tr><th style="width: 30%">Performance standard</th><th>Result · target</th><th>Outcome</th><th class="num">Occurrences</th><th class="num">Proposed</th><th>Review</th><th></th></tr></thead>
<tbody>
${group("Service Delivery", "whether the scheduled service ran, and ran on time")}
${row("On-Time Performance (Fixed Route)", "OTP_FIXED_ROUTE", "High", "91.4%", "Target ≥ 93.0%", tier("warning", "Warning"), "—", "$0", pill("pill-success", "Confirmed"))}
${row("Missed Trips Fixed Route / Microtransit", "MISSED_TRIPS_FR", "High", "7 occurrences", "Target 0 · 3rd month below", tier("tier1", "Tier 1 penalty"), "7", "$3,500", pill("pill-muted", "Awaiting review"))}
${row("Garage Departure Compliance", "GARAGE_DEPARTURE", "Medium", "12 occurrences", "Target ≤ 5", tier("tier1", "Tier 1 penalty"), "12", "$2,400", pill("pill-muted", "Awaiting review"))}
${group("Safety", "collisions, inspections, and the safety programme")}
${row("Preventable Collisions", "PREVENTABLE_COLLISIONS", "High · safety-critical", "2 occurrences", "Target 0 · CAP flagged · reimbursement pending", tier("tier2", "Tier 2 penalty"), "2", "$5,000", pill("pill-muted", "Awaiting review"))}
${row("Shutdown Vehicle", "SHUTDOWN_VEHICLE", "High", "3 vehicle-days", "Target ≤ 4", tier("warning", "Warning"), "1", "$0", pill("pill-success", "Confirmed"))}
${row("Safety Meeting Attendance Compliance", "SAFETY_MEETING", "Low", "Figure not entered", "Target ≥ 90%", tier("na", "Not assessable"), "—", "—", '<a style="font-size: 12px; font-weight: 600">Enter figure</a>')}
${group("Maintenance &amp; Fleet", "vehicle availability, reliability and condition")}
${row("Average Miles Between Road Calls", "AVG_MILES_ROAD_CALLS", "Medium", "6,820 mi", "Target ≥ 7,500 mi", tier("tier1", "Tier 1 penalty"), "—", "$1,500", pill("pill-accent", "Adjusted → $750"))}
${row("Bus Cleaning Compliance", "BUS_CLEANING", "No priority", "Figure not entered", "Target ≥ 95%", tier("na", "Not assessable"), "—", "—", '<a style="font-size: 12px; font-weight: 600">Enter figure</a>')}
${group("Customer Experience", "what the rider encounters, including accessibility")}
${row("Operator Conduct Complaints", "OPERATOR_CONDUCT", "High", "8 complaints", "Target &lt; 11", tier("meets", "Meets the standard"), "8", "$0", pill("pill-success", "Confirmed"))}
${row("ADA &amp; Title VI Non-Compliance", "ADA_TITLE_VI", "Medium · safety-critical", "1 occurrence", "Target 0", tier("tier1", "Tier 1 penalty"), "1", "$1,000", pill("pill-accent", "Waived"))}
${group("Reporting &amp; Compliance", "records and submissions the contract requires")}
${row("Incident and Data Reporting", "INCIDENT_REPORTING", "Medium", "0 occurrences", "Target 0", tier("meets", "Meets the standard"), "0", "$0", pill("pill-success", "Confirmed"))}
<tr class="pa-total"><td colspan="3">Totals for August 2026</td><td class="num">31</td><td class="num">$13,400</td><td colspan="2">Recommended so far $750</td></tr>
</tbody></table></div>
</section>`;
}

/* ------------------------------------------------------------- KPI detail */
function kpiDetailBody() {
  const obs = [
    ["08/02/2026", "Trip 4412 did not operate; no vehicle assigned at pullout", "Missed Trips", "Trip 4412 · 08/02/2026", pill("pill-success", "Confirmed")],
    ["08/02/2026", "Trip 4416 did not operate; operator no-show", "Missed Trips", "Trip 4416 · 08/02/2026", pill("pill-success", "Confirmed")],
    ["08/05/2026", "Trip 4418 did not operate", "Missed Trips", "Trip 4418 · 08/05/2026", pill("pill-warning", "Candidate")],
    ["08/09/2026", "Trip 4501 did not operate; vehicle breakdown before first stop", "Missed Trips", "Trip 4501 · 08/09/2026", pill("pill-success", "Confirmed")],
    ["08/12/2026", "Trip 4433 did not operate", "Missed Trips", "Trip 4433 · 08/12/2026", pill("pill-success", "Confirmed")],
    ["08/16/2026", "Trip 4470 did not operate; late relief not covered", "Missed Trips", "Trip 4470 · 08/16/2026", pill("pill-success", "Confirmed")],
    ["08/23/2026", "Trip 4422 did not operate", "Missed Trips", "Trip 4422 · 08/23/2026", pill("pill-warning", "Candidate")],
  ];
  return `<section class="pa-stack">
<a class="pa-crumb">${I.chevronLeft(14)} Back to scorecard</a>
<div class="pa-detail">
  <div class="pa-stack">
    <div class="pa-detail-head">
      <div><h3>Missed Trips Fixed Route / Microtransit</h3><p><span class="mono-ref">MISSED_TRIPS_FR</span> · Service Delivery · High priority · 7 occurrences against a target of 0</p></div>
      ${tier("tier1", "Tier 1 penalty")}
    </div>
    <div class="pa-calc">
      <div><span>Base</span><strong>$3,500</strong></div><b>−</b>
      <div><span>Relief</span><strong>$0</strong></div><b>×</b>
      <div><span>Escalation</span><strong>1.0</strong></div>
      <div class="result"><span>Proposed penalty</span><strong>$3,500</strong></div>
    </div>
    <div class="pa-glance-meta" style="margin: 0">Data completeness 100%${I.dot()}Third consecutive month below the standard${I.dot()}$500 per occurrence, Tier 1 band from the catalog ladder</div>
    <div class="pa-section-head"><div><h3 style="font-size: 14px">Observations</h3><p>The occurrences this figure counts. Candidates are counted until dismissed.</p></div><div class="pa-section-actions"><a class="btn-sm">Open in Occurrences ${I.chevronRight(12)}</a></div></div>
    <div class="pa-table-wrap"><table class="data">
      <thead><tr><th>Date</th><th>Description</th><th>Observed in</th><th>Status</th></tr></thead>
      <tbody>${obs.map(([d, desc, mod, ref, st]) => `<tr><td style="white-space: nowrap">${d}</td><td>${desc}</td><td><span class="pa-obs"><a>${mod}</a><small class="mono-ref">${ref}</small></span></td><td>${st}</td></tr>`).join("")}</tbody>
    </table></div>
  </div>
  <aside class="pa-stack">
    <div class="pa-card">
      <h4>Review</h4><p>Automation proposed $3,500. A reviewer recommends treatment; the Issuing Authority finalizes.</p>
      <div style="margin: 10px 0 12px">${pill("pill-muted", "Awaiting your recommendation")}</div>
      <div class="pa-actions-col"><span class="btn-primary">Recommend confirmation</span><span class="btn-sm">Recommend adjustment…</span><span class="btn-sm">Recommend waiver…</span></div>
    </div>
    <div class="pa-card">
      <h4>Corrective action</h4><p>Three consecutive months below the standard. A CAP determination is flagged and stays independent of any adjustment or waiver above.</p>
      <div style="margin-top: 10px">${pill("pill-warning", "CAP flagged · pending issuance")}</div>
    </div>
    <div class="pa-card pa-evidence">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px"><h4 style="margin: 0">Evidence</h4><span class="btn-sm">${I.upload(12)} Add version</span></div>
      <p style="margin-top: 4px">Immutable, content-hashed. The newest version supersedes the last.</p>
      <ul>
        <li>${I.file(16)}<span class="grow">missed-trips-aug-2026-v2.pdf<small>Contractor-visible · Sep 6 · Rob</small></span><span class="mono-ref">a3f9c02e…</span></li>
        <li>${I.file(16)}<span class="grow">missed-trips-aug-2026.pdf<small>Contractor-visible · Sep 3 · superseded</small></span><span class="mono-ref">7b1d44a0…</span></li>
      </ul>
    </div>
    <div class="pa-card">
      <h4>About this standard</h4>
      <dl class="pa-kv" style="margin-top: 8px"><dt>Source</dt><dd>Raised by OnBoard compliance</dd><dt>Team</dt><dd>Operations Control</dd><dt>Owner</dt><dd>Rob</dd><dt>Band</dt><dd>Catalog ladder · $500 per occurrence</dd></dl>
    </div>
  </aside>
</div>
</section>`;
}

/* ------------------------------------------------------------ occurrences */
function occurrencesBody() {
  const rows = [
    ["08/01/2026", "Garage Departure Compliance", "Block 1210/1 left 11 minutes late during MVTA-directed detour", ["Garage Departures · Fixed Route", "Block 1210/1 · 08/01/2026"], pill("pill-muted", "Dismissed"), "MVTA directed", "—", `<span class="btn-sm" disabled>Confirm</span><span class="btn-sm" disabled>Dismiss</span>`],
    ["08/02/2026", "Missed Trips Fixed Route / Microtransit", "Trip 4412 did not operate; no vehicle assigned at pullout", ["Missed Trips", "Trip 4412 · 08/02/2026"], pill("pill-success", "Confirmed"), "Contractor error", "—", `<span class="btn-sm" disabled>Confirm</span><span class="btn-sm">Dismiss</span>`],
    ["08/03/2026", "Garage Departure Compliance", "Block 1305/2 left the garage 14 minutes late", ["Garage Departures · Fixed Route", "Block 1305/2 · 08/03/2026"], pill("pill-success", "Confirmed"), "Contractor error", "—", `<span class="btn-sm" disabled>Confirm</span><span class="btn-sm">Dismiss</span>`],
    ["08/03/2026", "Garage Departure Compliance", "Block 1420/1 missed pullout; run never left", ["Garage Departures · Fixed Route", "Block 1420/1 · 08/03/2026"], pill("pill-warning", "Candidate"), "Undetermined", "—", `<span class="btn-sm">Confirm</span><span class="btn-sm">Dismiss</span>`],
    ["08/04/2026", "Preventable Collisions", "Fleet 2217 struck fixed object at Burnsville Transit Station; body shop estimate pending", null, pill("pill-success", "Confirmed"), "Contractor error", `<span class="btn-sm" style="border-color: var(--highlight-border); background: var(--highlight-bg)">Set amount…</span><small>$2,500 – $10,000</small>`, `<span class="btn-sm" disabled>Confirm</span><span class="btn-sm">Dismiss</span>`],
    ["08/05/2026", "Missed Trips Fixed Route / Microtransit", "Trip 4418 did not operate", ["Missed Trips", "Trip 4418 · 08/05/2026"], pill("pill-warning", "Candidate"), "Undetermined", "—", `<span class="btn-sm">Confirm</span><span class="btn-sm">Dismiss</span>`],
    ["08/06/2026", "Shutdown Vehicle", "Fleet 2240 held out of service 3 days; wheelchair lift fault", null, pill("pill-success", "Confirmed"), "Excusable", "—", `<span class="btn-sm" disabled>Confirm</span><span class="btn-sm">Dismiss</span>`],
    ["08/07/2026", "ADA &amp; Title VI Non-Compliance", "Rider report: lift not deployed on request at Apple Valley Transit Station", null, pill("pill-success", "Confirmed"), "Contractor error", "—", `<span class="btn-sm" disabled>Confirm</span><span class="btn-sm">Dismiss</span>`],
    ["08/11/2026", "Garage Departure Compliance", "Duty D-2291 started 16 minutes after scheduled", ["Garage Departures · On-Demand", "Duty D-2291 · 08/11/2026"], pill("pill-warning", "Candidate"), "Undetermined", "—", `<span class="btn-sm">Confirm</span><span class="btn-sm">Dismiss</span>`],
  ];
  return `<section class="pa-stack">
<div class="pa-section-head"><div><h3>Occurrences</h3><p>Every observation raised for this month, from OnBoard’s own modules or entered by hand. Confirm what counts, dismiss what does not, and give a figure where the contract states a range.</p></div><div class="pa-section-actions"><span class="btn-sm">Add occurrence by hand</span></div></div>
<div class="pa-filters">
  <span class="pa-segmented"><button class="active">All <b>31</b></button><button>Candidate <b>6</b></button><button>Confirmed <b>24</b></button><button>Dismissed <b>1</b></button></span>
  <span class="f placeholder" style="min-width: 220px">All standards ${I.chevronDown(14)}</span>
  <span class="f placeholder pa-search">${I.search(14)} <span style="flex: 1">Search descriptions, trips, blocks</span></span>
</div>
<div class="pa-notice">${I.alert(16)}<span>1 confirmed occurrence carries a penalty the contract states as a range. The month cannot be read as complete until a reviewer records the figure. <a>Set the amount</a></span></div>
<div class="pa-table-wrap"><table class="data">
<thead><tr><th>Date</th><th style="width: 17%">Standard</th><th style="width: 30%">Description</th><th>Observed in</th><th>Status · attribution</th><th>Amount</th><th>Review</th></tr></thead>
<tbody>${rows.map(([d, s, desc, src, st, attr, amt, act]) => `<tr><td style="white-space: nowrap">${d}</td><td>${s}</td><td>${desc}</td><td>${src ? `<span class="pa-obs"><a>${src[0]}</a><small class="mono-ref">${src[1]}</small></span>` : '<small style="margin: 0">Entered by hand</small>'}</td><td><span class="pa-status-cell">${st}<small>${attr}</small></span></td><td style="white-space: nowrap">${amt}</td><td style="white-space: nowrap"><span style="display: inline-flex; gap: 6px">${act}</span></td></tr>`).join("")}</tbody>
</table></div>
<p class="muted" style="margin: 0; font-size: 12px">Showing 9 of 31, newest first. Dismissals are recorded with a reason and stay in the log.</p>
</section>`;
}

/* --------------------------------------------------------- monthly metrics */
function metricsBody() {
  const entered = (name, code, unit, value, note, by) => `<div class="pa-metric-row"><div><strong>${name}</strong><small>${code} · ${unit}</small></div><span class="f unit">${value}<span>${unit}</span></span><div style="font-size: 12.5px">${note}</div><div style="font-size: 12px; color: var(--text-dim)">${by}</div><div>${pill("pill-success", "Entered")}</div></div>`;
  const missing = (name, code, unit, owner) => `<div class="pa-metric-row"><div><strong>${name}</strong><small>${code} · ${unit}</small></div><span class="f unit placeholder">Value<span>${unit}</span></span><span class="f placeholder">Source of record</span><div style="font-size: 12px; color: var(--text-dim)">${owner}</div><div style="display: flex; gap: 8px; align-items: center">${pill("pill-warning", "Missing")}<span class="btn-sm" disabled>Save</span></div></div>`;
  return `<section class="pa-stack">
<div class="pa-section-head"><div><h3>Monthly metrics</h3><p>The figures nobody feeds automatically. Each is one line: what the month’s value was, and where it was read from. The month cannot compute as complete until every scored figure is in.</p></div><div class="pa-section-actions"><span class="muted" style="font-size: 12px">2 of 4 entered</span><span class="pa-progress" style="width: 120px"><i style="width: 50%"></i></span></div></div>
<div class="pa-table-wrap">
  <div class="pa-metric-head"><span>Standard</span><span>August value</span><span>Source of record</span><span>Owner · entered</span><span></span></div>
  ${missing("Safety Meeting Attendance Compliance", "SAFETY_MEETING", "percent", "Maurice")}
  ${missing("Bus Cleaning Compliance", "BUS_CLEANING", "percent", "No owner set")}
  ${entered("Average Miles Between Road Calls", "AVG_MILES_ROAD_CALLS", "miles", "6,820", "Fleet maintenance report, Sep 1 export", "Maurice · Sep 3")}
  ${entered("Operator Conduct Complaints", "OPERATOR_CONDUCT", "occurrences", "8", "Customer service log, Aug 31 month-end count", "Rob · Sep 2")}
</div>
<div class="pa-glance-meta" style="margin: 0">A saved figure stamps who entered it and when. Changing one re-opens the month for recompute.</div>
<p class="pa-group-label" style="margin-top: 6px">Not scored in this Agreement</p>
<div class="pa-glance-meta" style="margin: 0">Fleet Availability Short-Term${I.dot()}Fleet Availability Long-Term${I.dot()}Bus Deep Cleaning Rate${I.dot()}<a>Change assignments in Standards</a></div>
</section>`;
}

/* ----------------------------------------------------------------- review */
function reviewBody() {
  const pending = (name, meta, proposed) => `<div class="pa-review-row"><div><strong>${name}</strong><small>${meta}</small></div><div style="display: flex; align-items: center; gap: 16px"><strong style="font-size: 15px">${proposed}</strong><span class="pa-review-actions"><span class="btn-primary" style="padding: 7px 12px; font-size: 12px">Confirm</span><span class="btn-sm">Adjust…</span><span class="btn-sm">Waive…</span></span></div></div>`;
  const done = (name, meta, decision, reason) => `<div class="pa-review-row"><div><strong>${name}</strong><small>${meta}</small></div><div class="pa-decision">${decision}<small style="max-width: 320px">${reason}</small><span class="btn-sm">Change</span></div></div>`;
  return `<section class="pa-stack">
<div class="pa-section-head"><div><h3>Review</h3><p>Automation proposes a penalty for each standard. A reviewer recommends confirmation, an adjustment or a waiver, each with a reason on record. A separate Issuing Authority finalizes the month.</p></div><div class="pa-section-actions"><span class="btn-primary" disabled>Finalize $750</span></div></div>
<div class="pa-notice">${I.alert(16)}<span>Finalize is held until the 3 items below have a recommendation and the <a>2 missing figures</a> are entered.</span></div>
<p class="pa-group-label">Awaiting your recommendation · 3</p>
<div class="pa-table-wrap">
  ${pending("Preventable Collisions", "2 occurrences against 0 · Tier 2 penalty · CAP flagged · reimbursement amount pending", "$5,000")}
  ${pending("Missed Trips Fixed Route / Microtransit", "7 occurrences against 0 · Tier 1 penalty · third month below", "$3,500")}
  ${pending("Garage Departure Compliance", "12 occurrences against 5 · Tier 1 penalty", "$2,400")}
</div>
<p class="pa-group-label">Recommended · 6</p>
<div class="pa-table-wrap">
  ${done("Average Miles Between Road Calls", "6,820 mi against 7,500 · proposed $1,500", pill("pill-accent", "Adjusted → $750"), "Two road calls were tow-ins from MVTA-directed detour routing; reduced to the remaining shortfall.")}
  ${done("ADA &amp; Title VI Non-Compliance", "1 occurrence against 0 · proposed $1,000", pill("pill-accent", "Waived"), "Lift fault reported and repaired same day; contractor initiated retraining before the complaint.")}
  ${done("On-Time Performance (Fixed Route)", "91.4% against 93.0% · Warning · proposed $0", pill("pill-success", "Confirmed"), "")}
  ${done("Shutdown Vehicle", "3 vehicle-days against 4 · Warning · proposed $0", pill("pill-success", "Confirmed"), "")}
  ${done("Operator Conduct Complaints", "8 against 11 · Meets · proposed $0", pill("pill-success", "Confirmed"), "")}
  ${done("Incident and Data Reporting", "0 against 0 · Meets · proposed $0", pill("pill-success", "Confirmed"), "")}
</div>
<p class="pa-group-label">Not assessable · 2</p>
<div class="pa-glance-meta" style="margin: 0">Safety Meeting Attendance Compliance${I.dot()}Bus Cleaning Compliance${I.dot()}<a>Enter the figures under Monthly metrics</a></div>
</section>`;
}

/* ------------------------------------------------------------------- CAPs */
function capsBody() {
  return `<section class="pa-stack">
<div class="pa-section-head"><div><h3>Corrective Action Plans</h3><p>A CAP determination is a separate outcome from money: it is required when a standard reaches a Tier 2 band, misses three months running, or deviates more than 10%. Adjusting or waiving a penalty does not clear it.</p></div></div>
<p class="pa-group-label">This month · 2</p>
<div class="pa-table-wrap"><table class="data">
<thead><tr><th>Standard</th><th>Trigger</th><th>Status</th><th>Requested</th><th>Due</th><th>Owner</th><th></th></tr></thead>
<tbody>
<tr><td><strong>Preventable Collisions</strong><small>PREVENTABLE_COLLISIONS · safety-critical</small></td><td>Tier 2 outcome<small>Contract tier rule</small></td><td>${pill("pill-danger", "Required")}</td><td>09/03/2026</td><td>10/03/2026<small>30 days</small></td><td>Rob / Cody</td><td class="pa-row-chevron">${I.chevronRight(14)}</td></tr>
<tr><td><strong>Missed Trips Fixed Route / Microtransit</strong><small>MISSED_TRIPS_FR</small></td><td>Three consecutive months below<small>Jun, Jul, Aug 2026</small></td><td>${pill("pill-warning", "Pending issuance")}</td><td>—<small>Issued with the Final Assessment</small></td><td>—</td><td>Rob</td><td class="pa-row-chevron">${I.chevronRight(14)}</td></tr>
</tbody></table></div>
<p class="pa-group-label">Open from earlier months · 1</p>
<div class="pa-table-wrap"><table class="data">
<thead><tr><th>Standard</th><th>Trigger</th><th>Status</th><th>Requested</th><th>Due</th><th>Owner</th><th></th></tr></thead>
<tbody>
<tr><td><strong>Garage Departure Compliance</strong><small>GARAGE_DEPARTURE · from July 2026</small></td><td>Deviation over 10%</td><td>${pill("pill-accent", "In progress")}</td><td>08/05/2026</td><td>09/30/2026</td><td>Corrina / Maurice</td><td class="pa-row-chevron">${I.chevronRight(14)}</td></tr>
</tbody></table></div>
</section>`;
}

/* --------------------------------------------------------------- issuance */
function issuanceBody() {
  return `<section class="pa-stack">
<div class="pa-section-head"><div><h3>Issuance</h3><p>The official package: a Validation Draft shared with the contractor, then the immutable Final Assessment, then the dispute window. Each artifact is content-hashed and every sharing is attested.</p></div></div>
<div class="pa-steps">
  <div class="pa-step-card current"><span class="pa-step-no">1</span><h4>Validation Draft</h4><p>Can be generated at any point during review and regenerated after changes. Sharing it with the contractor opens a 5-business-day validation window.</p><div class="pa-step-state">${pill("pill-accent", "v2 generated Sep 5")}<span>· shared Sep 5</span></div><div class="pa-step-actions"><span class="btn-sm">Regenerate draft</span><span class="btn-sm">Record sharing…</span></div></div>
  <div class="pa-step-card locked"><span class="pa-step-no">2</span><h4>Final Assessment</h4><p>Available after the Issuing Authority finalizes the month. Issuing it fixes every item and starts the dispute clock.</p><div class="pa-step-state">${pill("pill-muted", "Waiting on finalization")}</div><div class="pa-step-actions"><span class="btn-sm" disabled>Generate final</span><span class="btn-sm" disabled>Issue…</span></div></div>
  <div class="pa-step-card locked"><span class="pa-step-no">3</span><h4>Disputes</h4><p>The contractor may challenge specific items until the deadline. Unchallenged items stay final.</p><div class="pa-step-state">${pill("pill-muted", "Opens on issuance")}</div></div>
</div>
<p class="pa-group-label">Artifacts</p>
<div class="pa-table-wrap"><table class="data">
<thead><tr><th>Artifact</th><th>Version</th><th>Generated</th><th>Shared / issued</th><th>Recipient</th><th>Hash</th><th></th></tr></thead>
<tbody>
<tr><td><strong>Validation Draft</strong></td><td>v2</td><td>09/05/2026</td><td>09/05/2026</td><td>Northline · contracts@…</td><td><span class="mono-ref">c81e3f0a7d2b…</span></td><td class="pa-row-chevron"><a class="btn-sm">Download</a></td></tr>
<tr><td><strong>Validation Draft</strong></td><td>v1</td><td>09/03/2026</td><td>— <small style="display: inline; margin: 0">superseded</small></td><td>—</td><td><span class="mono-ref">4d0a99b2e17c…</span></td><td class="pa-row-chevron"><a class="btn-sm">Download</a></td></tr>
</tbody></table></div>
<p class="pa-group-label">Disputes</p>
<div class="pa-empty"><strong>No disputes yet</strong>Disputes become available after the Final Assessment is issued. Each names the items it challenges.</div>
</section>`;
}

/* ---------------------------------------------------- at-a-glance options */
function altDoc(title, body, height) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <title>${title}</title>
  <style>${TOKENS}${SHELL}${MODULE}
  .pa-root { width: 1120px; min-height: ${height}px; padding: 20px; }
  .pa-note { color: var(--text-muted); font-size: 12px; margin: 0 0 12px; }
  </style>
</helmet>
<div class="pa-root" data-theme="light">${body}</div>
</x-dc>
</body>
</html>
`;
}

function glanceAltA() {
  return altDoc("At a glance · one line", `
<p class="pa-note"><strong style="color: var(--text)">Option A · One line.</strong> Identity, status and the two figures on a single 48px strip; the lifecycle is implied by the status pill and the next action. Most compact, least explanation.</p>
<section class="pa-glance" style="padding: 10px 14px; gap: 0">
  <div class="pa-glance-top">
    <div class="pa-identity" style="gap: 10px">
      <span class="pa-picker" style="font-size: 14px; padding: 4px 6px 4px 10px">Northline Transit Services ${I.chevronDown(13)}</span>
      <span class="pa-month"><span class="pa-step-btn" style="width: 26px; height: 26px">${I.chevronLeft(13)}</span><strong style="font-size: 14px; min-width: 128px">August 2026</strong><span class="pa-step-btn" style="width: 26px; height: 26px">${I.chevronRight(13)}</span></span>
      <span class="pill-sm pill-warning">In review</span>
      <span class="muted" style="font-size: 12px">3 items · 2 figures · 1 amount outstanding</span>
    </div>
    <div style="display: flex; align-items: center; gap: 18px">
      <div style="text-align: right"><span class="muted" style="font-size: 10.5px; display: block">Proposed</span><strong style="font-size: 16px">$13,400</strong></div>
      <div style="text-align: right"><span class="muted" style="font-size: 10.5px; display: block">Recommended</span><strong style="font-size: 16px">$750</strong></div>
      <span class="btn-primary" style="padding: 8px 14px; font-size: 12px">Continue review ${I.chevronRight(13)}</span>
    </div>
  </div>
</section>
<p class="pa-note" style="margin-top: 14px"><strong style="color: var(--text)">Tradeoff.</strong> Nothing tells a first-time viewer where the month is in its lifecycle or what “In review” unlocks; the outstanding items are a sentence, not links.</p>
`, 220);
}

function glanceAltB() {
  return altDoc("At a glance · lifecycle first", `
<p class="pa-note"><strong style="color: var(--text)">Option B · Lifecycle first.</strong> The six stages run the full width with the current stage carrying its own to-do; money and identity sit beneath. Best when the question is “where are we” rather than “how much”.</p>
<section class="pa-glance">
  <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px">
    <div class="pa-identity"><span class="pa-picker">Northline Transit Services ${I.chevronDown(14)}</span><span class="pa-month"><span class="pa-step-btn">${I.chevronLeft(14)}</span><strong>August 2026</strong><span class="pa-step-btn">${I.chevronRight(14)}</span></span></div>
    <span class="btn-primary">Continue review ${I.chevronRight(14)}</span>
  </div>
  <div style="padding: 8px 0 0">${lifecycle(3).replace('<span>In review<small>3 items left</small></span>', '<span>In review<small>3 items · 2 figures · 1 amount</small></span>')}</div>
  <div style="display: flex; gap: 28px; border-top: 1px solid var(--border); padding-top: 12px; align-items: center">
    <div><span class="muted" style="font-size: 11px; display: block">Proposed</span><strong style="font-size: 20px; font-weight: 800">$13,400</strong></div>
    <div><span class="muted" style="font-size: 11px; display: block">Recommended so far</span><strong style="font-size: 20px; font-weight: 800">$750</strong></div>
    <div class="muted" style="font-size: 12px; margin-left: auto">Agreement RFP 2025-07 · Attachment G v2 · 11 standards scored</div>
  </div>
</section>
<p class="pa-note" style="margin-top: 14px"><strong style="color: var(--text)">Tradeoff.</strong> Taller than the recommended card, and the outstanding items compete for the small text under one stage.</p>
`, 330);
}

/* ------------------------------------------------------------- admin shell */
const ADMIN_TOP = { title: "Performance Assessment setup", sub: "Contractors, Agreements, the standards catalog and the lists behind them" };

function secondaryNav(active) {
  const a = (k, label, icon) => `<a class="${active === k ? "active" : ""}">${icon}<span>${label}</span></a>`;
  return `<aside class="admin-secondary-nav" aria-label="Administration">
  <div class="admin-secondary-heading"><span class="admin-eyebrow">MANAGEMENT WORKSPACE</span><strong>Administration</strong></div>
  <nav class="admin-secondary-links">
    ${a("access", "Access &amp; Identity", I.shield())}${a("events", "Event Administration", I.bus())}${a("service", "Service Configuration", I.wrench())}${a("standards-svc", "Service Standards", I.wrench())}${a("integrations", "Integrations &amp; Data Health", I.wrench())}${a("matrix", "Decision Matrix", I.wrench())}${a("otp", "OTP Compliance", I.wrench())}
    <div class="admin-secondary-group"><span class="admin-secondary-group-label">Performance Assessment</span>${a("contractors", "Contractors", I.users())}${a("agreements", "Agreements", I.clock())}${a("standards", "Standards", I.assessment())}${a("lists", "Lists", I.wrench())}</div>
    <div class="admin-secondary-group">${a("governance", "Governance &amp; Audit", I.clock())}${a("subscribers", "Subscribers", I.users())}</div>
  </nav>
</aside>`;
}

function adminShell(key, headerTitle, body, frameHeight) {
  return page({
    title: headerTitle, active: "perf-setup", topTitle: ADMIN_TOP.title, topSub: ADMIN_TOP.sub, frameHeight, admin: true,
    main: `<div class="admin-layout">${secondaryNav(key)}<section class="admin-layout-content"><div class="panel-header"><span>${headerTitle}</span></div><div class="panel-body standards-page">${body}</div></section></div>`,
  });
}

const checkbox = (on, label) => `<span class="contractor-active"><span class="box ${on ? "on" : ""}">${on ? I.check(12) : ""}</span><span>${label}</span></span>`;
const field = (label, value, { placeholder = false, wide = false, hint = "", select = false } = {}) =>
  `<label class="${wide ? "standards-wide" : ""}"><span>${label}</span><span class="f ${placeholder ? "placeholder" : ""}">${value}${select ? I.chevronDown(14) : ""}</span>${hint ? `<small>${hint}</small>` : ""}</label>`;

/* ------------------------------------------------------ admin: contractors */
function adminContractors() {
  return adminShell("contractors", "Contractors", `
<div class="standards-head"><div><span class="assessment-eyebrow">PERFORMANCE ASSESSMENT · WHO IS ENGAGED</span><p>The operators MVTA has engaged. A contractor outlives any one contract term, so its record is kept here rather than inside an Agreement.</p></div><span class="btn-primary">New contractor</span></div>
<div class="standards-workspace">
  <section class="standards-list">
    <div class="standards-list-meta"><span>2 on record</span><span>1 current</span></div>
    <ul class="standards-rows">
      <li><span class="standards-row selected"><span class="standards-row-name"><strong>Northline Transit Services</strong></span><span class="standards-row-meta"><span class="standards-state scored">Current</span><small>Engaged 07/01/2025 – ongoing</small><small>· 1 Agreement</small></span></span></li>
      <li><span class="standards-row"><span class="standards-row-name"><strong>Metro Coach Partners</strong></span><span class="standards-row-meta"><span class="standards-state unassigned">Historical</span><small>07/01/2019 – 06/30/2025</small><small>· 1 Agreement</small></span></span></li>
    </ul>
  </section>
  <aside class="standards-detail">
    <div class="standards-detail-head"><div><h3>Northline Transit Services</h3><small class="muted" style="font-size: 11.5px">Contractor record · created 06/12/2025 by Tyre Fant</small></div><div class="standards-detail-actions"><span class="btn-sm">Mark historical</span></div></div>
    <div class="standards-tab-body">
      <div class="standards-grid">
        ${field("Name", "Northline Transit Services", { wide: true })}
        ${field("Engaged from", "07/01/2025")}
        ${field("Engagement ended", "MM/DD/YYYY", { placeholder: true, hint: "Leave empty while the contractor is still engaged." })}
        <div class="standards-wide">${checkbox(true, "Currently engaged")}</div>
      </div>
      <div class="standards-tier-actions"><span class="btn-primary">Save contractor</span><span class="standards-hint">Saving does not touch any Agreement or open month.</span></div>
      <p class="pa-group-label">Agreements under this contractor</p>
      <div class="agreement-summary">
        <div class="pa-card"><div><strong>RFP 2025-07</strong> <span class="standards-exhibit" style="margin-left: 6px">Attachment G v2</span><p style="margin-top: 3px">07/01/2025 – 06/30/2030 · 11 standards scored</p></div><div style="display: flex; gap: 8px; align-items: center">${pill("pill-success", "Active")}<a class="btn-sm">Open Agreement ${I.chevronRight(12)}</a></div></div>
      </div>
    </div>
  </aside>
</div>`, 1040);
}

/* ------------------------------------------------------- admin: agreements */
function adminAgreements() {
  return adminShell("agreements", "Agreements", `
<div class="standards-head"><div><span class="assessment-eyebrow">PERFORMANCE ASSESSMENT · CONTRACT TERMS</span><p>A term binding one contractor to a set of standards between two dates. Assessment periods and the compliance candidate poll both refuse to run without an active one.</p></div><span class="btn-primary">New Agreement</span></div>
<div class="standards-workspace">
  <section class="standards-list">
    <div class="standards-list-meta"><span>2 on record</span><span>1 active</span></div>
    <ul class="standards-rows">
      <li><span class="standards-row selected"><span class="standards-row-name"><strong>Northline Transit Services · RFP 2025-07</strong><small class="standards-row-description">07/01/2025 to 06/30/2030 · Attachment G v2</small></span><span class="standards-row-meta"><span class="standards-state scored">Active</span><small>11 standards scored</small><small>· 14 months assessed</small></span></span></li>
      <li><span class="standards-row"><span class="standards-row-name"><strong>Metro Coach Partners · Contract 2019-03</strong><small class="standards-row-description">07/01/2019 to 06/30/2025 · Attachment G</small></span><span class="standards-row-meta"><span class="standards-state unassigned">Ended</span><small>26 standards scored</small><small>· 72 months assessed</small></span></span></li>
    </ul>
  </section>
  <aside class="standards-detail">
    <div class="standards-detail-head"><div><h3>Northline Transit Services · RFP 2025-07</h3><small class="muted" style="font-size: 11.5px">Active Agreement · 11 standards scored · <a>Edit assignments in Standards</a></small></div><div class="standards-detail-actions"><span class="btn-sm">End term…</span></div></div>
    <div class="standards-tab-body">
      <fieldset class="standards-fieldset"><legend>Term</legend><div class="standards-grid">
        ${field("Contractor", "Northline Transit Services", { wide: true, select: true })}
        ${field("Term start", "07/01/2025")}${field("Term end", "06/30/2030")}
      </div></fieldset>
      <fieldset class="standards-fieldset"><legend>Contract references</legend><div class="standards-grid">
        ${field("Contract number", "RFP 2025-07")}
        ${field("Standards exhibit", "Attachment G v2", { hint: "What this contract calls the document the standards come from. Cited wherever the console refers to it." })}
      </div></fieldset>
      <fieldset class="standards-fieldset"><legend>Process</legend><div class="standards-grid">
        ${field("Validation window", "5 <span class='muted' style='font-size: 11.5px'>business days</span>", { hint: "How long the contractor has to validate a shared draft." })}
        ${field("Record retention", "7 <span class='muted' style='font-size: 11.5px'>years</span>", { hint: "How long issued assessments and their evidence are kept." })}
        <div class="standards-wide">${checkbox(true, "Current Agreement for this contractor")}</div>
      </div></fieldset>
      <div class="standards-tier-actions"><span class="btn-primary">Save Agreement</span><span class="standards-hint">Months already opened keep the exhibit and windows they were opened with.</span></div>
    </div>
  </aside>
</div>`, 1040);
}

/* -------------------------------------------------------- admin: standards */
function adminStandards() {
  const row = (name, desc, state, meta, selected = false) => `<li><span class="standards-row ${selected ? "selected" : ""}"><span class="standards-row-name"><strong>${name}</strong><small class="standards-row-description ${desc ? "" : "is-empty"}">${desc || "No description yet"}</small></span><span class="standards-row-meta"><span class="standards-state ${state.toLowerCase()}">${state}</span><small>${meta}</small></span></span></li>`;
  const band = (label, cls, criteria, penalty, cap, readout) => `<div class="standards-band">
    <div class="standards-band-head"><div style="display: flex; align-items: center; gap: 10px">${tier(cls, label)}<span class="muted" style="font-size: 11.5px">Band ${criteria[0]}</span></div><a style="font-size: 12px; font-weight: 700">Remove band</a></div>
    <div class="standards-band-fields">
      <label><span>Which values</span><span class="f">${criteria[1]}${I.chevronDown(14)}</span></label>
      <label><span>${criteria[2]}</span><span class="standards-measure">${criteria[3]}<span>occurrences</span></span></label>
      <label><span>Which occurrences</span><span class="f ${criteria[4] === "Any" ? "placeholder" : ""}">${criteria[4]}${I.chevronDown(14)}</span></label>
    </div>
    <div class="standards-band-fields">
      <label><span>Charge</span><span class="f">${penalty[0]}${I.chevronDown(14)}</span></label>
      <label><span>Amount</span><span class="standards-measure ${penalty[1] ? "" : "placeholder"}">${penalty[1] || "—"}<span>USD</span></span></label>
      <div style="padding-bottom: 10px">${checkbox(cap, "Triggers a CAP")}</div>
    </div>
    <p class="standards-band-readout">${readout}</p>
  </div>`;
  return adminShell("standards", "Performance Standards", `
<div class="standards-head"><div><span class="assessment-eyebrow">ADMINISTRATION · CONTRACT GOVERNANCE</span><p>The catalog of standards and the penalty bands that score them. Changing a band is contract governance: it writes a new ladder version and never restates a month already opened.</p></div><div class="standards-detail-actions"><span class="btn-sm">Import from exhibit…</span><span class="btn-primary">New standard</span></div></div>
<div class="standards-agreement-bar"><span class="label">Agreement</span><span class="f">Northline Transit Services · RFP 2025-07 · 07/01/2025 – 06/30/2030${I.chevronDown(14)}</span><span class="standards-exhibit">Attachment G v2</span><span class="btn-sm">Edit Agreement</span></div>
<div class="standards-workspace">
  <section class="standards-list">
    <div class="standards-list-toolbar"><span class="f placeholder">${I.search(14)}<span style="flex: 1">Search name, code or description</span></span><span class="f narrow">Scored ${I.chevronDown(14)}</span></div>
    <div class="standards-list-meta"><span>11 of 30 standards · scored in this Agreement</span><a>Show all</a></div>
    <ul class="standards-rows">
      <li class="standards-group">Service Delivery</li>
      ${row("On-Time Performance (Fixed Route)", "Share of timepoint departures within the contract’s on-time window, read from the Avail feed.", "Scored", "OTP_FIXED_ROUTE · ingested from a feed")}
      ${row("Missed Trips Fixed Route / Microtransit", "A scheduled revenue trip that did not operate. Raised by the Missed Trips module; confirmed by a reviewer.", "Scored", "MISSED_TRIPS_FR · raised by OnBoard compliance", true)}
      ${row("Garage Departure Compliance", "Pullouts later than the allowance, or never made, from the Garage Departures modules.", "Scored", "GARAGE_DEPARTURE · raised by OnBoard compliance")}
      <li class="standards-group">Safety</li>
      ${row("Preventable Collisions", "Collisions the review board finds preventable. Damage reimbursement is a range set by the reviewer.", "Scored", "PREVENTABLE_COLLISIONS · entered by hand")}
      ${row("Shutdown Vehicle", "", "Scored", "SHUTDOWN_VEHICLE · entered by hand")}
      ${row("Safety Meeting Attendance Compliance", "Share of operators attending the monthly safety meeting.", "Scored", "SAFETY_MEETING · entered by hand")}
      <li class="standards-group">Maintenance &amp; Fleet</li>
      ${row("Average Miles Between Road Calls", "Preventative maintenance indicator from the fleet report.", "Scored", "AVG_MILES_ROAD_CALLS · transcribed")}
      ${row("Bus Cleaning Compliance", "", "Scored", "BUS_CLEANING · entered by hand")}
      <li class="standards-group">Customer Experience</li>
      ${row("Operator Conduct Complaints", "Substantiated complaints from the customer service log.", "Scored", "OPERATOR_CONDUCT · transcribed")}
      ${row("ADA &amp; Title VI Non-Compliance", "", "Scored", "ADA_TITLE_VI · entered by hand")}
      <li class="standards-group">Reporting &amp; Compliance</li>
      ${row("Incident and Data Reporting", "Reports and data submissions the contract requires, on time and complete.", "Scored", "INCIDENT_REPORTING · entered by hand")}
    </ul>
  </section>
  <aside class="standards-detail">
    <div class="standards-detail-head">
      <div><h3>Missed Trips Fixed Route / Microtransit</h3><small class="mono-ref">MISSED_TRIPS_FR</small><span class="standards-target">Contract target: 0 missed trips a month</span>
        <ul class="standards-band-list"><li>${tier("meets", "Meets the standard")}<small>0 occurrences: no penalty</small></li><li>${tier("tier1", "Tier 1 penalty")}<small>1 or more: $500 per occurrence</small></li><li>${tier("tier2", "Tier 2 penalty")}<small>Unreported: $1,000 per occurrence · CAP</small></li></ul></div>
      <div class="standards-detail-actions"><span class="btn-sm">Duplicate</span><span class="btn-sm danger">Retire</span></div>
    </div>
    <nav class="standards-tabs"><button>Details</button><button class="active">Penalty bands</button><button>Assignment</button></nav>
    <div class="standards-tab-body">
      <div class="standards-agreement-bar" style="background: var(--surface-bg); flex-wrap: wrap"><span class="label">Ladder</span><span class="pa-segmented"><button class="active">Catalog default</button><button>Override for this Agreement</button></span><span class="standards-hint" style="flex-basis: 100%">An Agreement ladder replaces the catalog ladder entirely: every band, not just the ones set here.</span></div>
      <div class="standards-bands">
        ${band("Meets the standard", "meets", ["1", "Exactly", "Value", "0", "Any"], ["No penalty", ""], false, "Met at zero missed trips. Nothing is charged.")}
        ${band("Tier 1 penalty", "tier1", ["2", "At or above", "From", "1", "Any"], ["Per occurrence", "500"], false, "$500 per occurrence, for every missed trip in the month.")}
        ${band("Tier 2 penalty", "tier2", ["3", "At or above", "From", "1", "Unreported to OCC"], ["Per occurrence", "1,000"], true, "$1,000 per occurrence when the trip was not reported to OCC, and a CAP is required.")}
      </div>
      <div class="standards-tier-actions"><span class="btn-sm">Add band</span><label style="display: grid; gap: 5px"><span class="standards-hint" style="font-weight: 700; color: var(--text-dim)">Effective from</span><span class="f" style="min-height: 36px">10/01/2026</span></label><span class="btn-primary">Save penalty bands</span></div>
      <p class="standards-hint" style="margin: 0">Saving writes a new ladder version effective from this date. Months already opened keep the bands they were opened with.</p>
    </div>
  </aside>
</div>`, 1520);
}

/* ------------------------------------------------------------ admin: lists */
function adminLists() {
  const lists = [["Units", "7"], ["Categories", "7", true], ["Priorities", "4"], ["Conditions", "3"], ["Source systems", "5"], ["Responsible teams", "6"], ["Assigned owners", "9"], ["Tier labels", "4", false, true], ["Charge bases", "6", false, true], ["Measurement sources", "4", false, true], ["Standard types", "2", false, true], ["Directions", "2", false, true]];
  const rows = [["Service Delivery", "service_delivery", "1", "Whether the scheduled service ran, and ran on time.", "3"], ["Operations &amp; Supervision", "operations", "2", "How the service was run and supervised on the day.", "4"], ["Staffing &amp; Training", "staffing", "3", "Whether the people running the service were there and qualified.", "11"], ["Safety", "safety", "4", "Collisions, inspections, and the safety programme.", "4"], ["Maintenance &amp; Fleet", "maintenance", "5", "Vehicle availability, reliability and condition.", "5"], ["Customer Experience", "customer", "6", "What the rider encounters, including accessibility.", "2"], ["Reporting &amp; Compliance", "reporting", "7", "Records and submissions the contract requires.", "1"]];
  return adminShell("lists", "Lists", `
<div class="standards-head"><div><span class="assessment-eyebrow">PERFORMANCE ASSESSMENT · VOCABULARY</span><p>The lists behind every picker in the configurator. Rename them in the contract’s own words, reorder them, and retire the ones MVTA does not use. System lists are what the scoring engine branches on: their labels are yours, their values are not.</p></div></div>
<div class="standards-workspace" style="grid-template-columns: 236px minmax(0, 1fr)">
  <section class="standards-list">
    <div class="standards-list-meta"><span>12 lists</span><span>5 system</span></div>
    <ul class="standards-rows lists-rows">
      ${lists.map(([n, c, sel, sys]) => `<li><span class="standards-row ${sel ? "selected" : ""}"><span><strong style="font-size: 13px">${n}</strong>${sys ? '<small style="display: block">System list</small>' : ""}</span><span class="count">${c}</span></span></li>`).join("")}
    </ul>
  </section>
  <aside class="standards-detail">
    <div class="standards-detail-head"><div><h3>Categories</h3><small class="muted" style="font-size: 12px">Which part of the contract a standard belongs to. Groups the catalog and a scorecard in the order the contract reads; never read when a month is scored.</small></div><div class="standards-detail-actions">${pill("pill-success", "Owned list")}</div></div>
    <div class="standards-tab-body">
      <div class="pa-table-wrap"><table class="data lists-table">
        <thead><tr><th>Label</th><th>Value</th><th class="num">Order</th><th class="num">Standards</th><th>In use</th><th></th></tr></thead>
        <tbody>${rows.map(([l, v, o, d, n]) => `<tr><td><span class="f" style="min-height: 34px; padding: 6px 10px">${l}</span><small>${d}</small></td><td><span class="mono-ref">${v}</span></td><td class="num"><span class="f" style="min-height: 34px; padding: 6px 10px; width: 56px; justify-content: center">${o}</span></td><td class="num">${n}</td><td><span class="standards-toggle">${checkbox(true, "Offered")}</span></td><td><a style="font-size: 12px; font-weight: 700">Delete</a></td></tr>`).join("")}</tbody>
      </table></div>
      <div class="standards-new-value"><label><span>New value</span><span class="f placeholder">stored value</span></label><label><span>Label</span><span class="f placeholder">what the console shows</span></label><span class="btn-primary">Add to categories</span></div>
      <p class="standards-hint" style="margin: 0">A label change shows everywhere the value appears from the next load. Retiring a value hides it from pickers without touching the standards already using it.</p>
    </div>
  </aside>
</div>`, 1180);
}

/* ------------------------------------------------------------------ write */
const files = {
  "Main.dc.html": moduleShell("scorecard", scorecardBody(), 1290),
  "KpiDetail.dc.html": moduleShell("scorecard", kpiDetailBody(), 1290),
  "Occurrences.dc.html": moduleShell("occurrences", occurrencesBody(), 1400),
  "MonthlyMetrics.dc.html": moduleShell("metrics", metricsBody(), 1080),
  "Review.dc.html": moduleShell("review", reviewBody(), 1290),
  "Caps.dc.html": moduleShell("caps", capsBody(), 1080),
  "Issuance.dc.html": moduleShell("issuance", issuanceBody(), 1290),
  "GlanceAltA.dc.html": glanceAltA(),
  "GlanceAltB.dc.html": glanceAltB(),
  "AdminContractors.dc.html": adminContractors(),
  "AdminAgreements.dc.html": adminAgreements(),
  "AdminStandards.dc.html": adminStandards(),
  "AdminLists.dc.html": adminLists(),
};
for (const [name, html] of Object.entries(files)) writeFileSync(join(here, name), html);
console.log(`wrote ${Object.keys(files).length} artboards`);
