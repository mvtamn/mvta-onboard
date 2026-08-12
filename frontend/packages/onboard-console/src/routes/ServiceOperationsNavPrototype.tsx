import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import "./ServiceOperationsNavPrototype.css";

// PROTOTYPE — three visual treatments of the left navigation, switchable with
// ?variant=a|b|c. This route is dev-only and should not be promoted directly.
const VARIANTS = [
  { key: "a", label: "Grouped workflow sections" },
  { key: "b", label: "Service Operations workspace" },
  { key: "c", label: "Compact collapsible specialists" },
] as const;

type VariantKey = (typeof VARIANTS)[number]["key"];

const dailyLinks = [
  ["◈", "Overview"],
  ["✎", "Compose"],
  ["◉", "Suggested Alerts", "3"],
  ["▣", "Active Service Alerts", "5"],
  ["⌁", "Service Risk & Quality"],
];

const specialistLinks = [
  ["◇", "Detours & Closures"],
  ["◇", "Event Workspace"],
];

const governanceLinks = [
  ["▤", "Compliance"],
  ["▤", "Performance Assessment"],
];

function normalizeVariant(value: string | null): VariantKey {
  return VARIANTS.some((variant) => variant.key === value) ? value as VariantKey : "a";
}

export function ServiceOperationsNavPrototype() {
  const [params, setParams] = useSearchParams();
  const [changelogOpen, setChangelogOpen] = useState(false);
  const variant = normalizeVariant(params.get("variant"));
  const index = VARIANTS.findIndex((item) => item.key === variant);

  function setVariant(next: VariantKey) {
    setParams({ variant: next });
  }

  function cycle(direction: number) {
    const next = (index + direction + VARIANTS.length) % VARIANTS.length;
    setVariant(VARIANTS[next].key);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className={`nav-prototype variant-${variant}`}>
      <div className="nav-prototype-stage">
        <div className="nav-prototype-shell">
          <PrototypeBrand onVersionClick={() => setChangelogOpen(true)} />
          {variant === "a" && <VariantA />}
          {variant === "b" && <VariantB />}
          {variant === "c" && <VariantC />}
          <div className="nav-prototype-footer">
            <span>● Console live</span>
            <span>Tyre Fant · OCC.Admin</span>
          </div>
        </div>
        <main className="nav-prototype-content">
          <div className="prototype-topbar"><span>Service Operations</span><span>Internal MVTA operations console</span></div>
          <div className="prototype-placeholder">
            <span className="prototype-kicker">Visual treatment preview</span>
            <h1>{VARIANTS[index].label}</h1>
            <p>Compare the navigation hierarchy against a realistic console content area. The navigation is the only design under evaluation.</p>
            <div className="prototype-content-grid"><div /><div /><div /></div>
          </div>
        </main>
      </div>
      <PrototypeSwitcher variant={variant} onCycle={cycle} onSelect={setVariant} />
      {changelogOpen ? <ChangelogPopover onClose={() => setChangelogOpen(false)} /> : null}
    </div>
  );
}

function PrototypeBrand({ onVersionClick }: { onVersionClick: () => void }) {
  return <div className="nav-prototype-brand"><span>MVTA</span><div>OnBoard<button onClick={onVersionClick}>v1.5.23 · View updates</button></div></div>;
}

function NavGroup({ title, links, emphasized = false }: { title: string; links: string[][]; emphasized?: boolean }) {
  return <section className={`nav-prototype-group${emphasized ? " emphasized" : ""}`}>
    <h2>{title}</h2>
    {links.map(([icon, label, badge]) => <a href="#" key={label} className={label === "Overview" ? "active" : ""}><i>{icon}</i><span>{label}</span>{badge ? <b>{badge}</b> : null}</a>)}
  </section>;
}

function VariantA() {
  return <nav className="nav-prototype-links"><NavGroup title="Service Operations" links={dailyLinks} emphasized /><NavGroup title="Specialist Operations" links={specialistLinks} /><NavGroup title="Compliance & Assessment" links={governanceLinks} /><div className="nav-prototype-utility"><a href="#">Subscribers</a><a href="#">Audit Log</a><a href="#">Admin</a></div></nav>;
}

function VariantB() {
  return <nav className="nav-prototype-links variant-b-links">
    <div className="nav-prototype-hero-link"><strong>Service Operations</strong><span>Daily communications and monitoring</span><a href="#">Open overview →</a></div>
    <NavGroup title="Daily workflows" links={dailyLinks.slice(1)} emphasized />
    <NavGroup title="Specialist operations" links={specialistLinks} />
    <NavGroup title="Governance" links={governanceLinks} />
    <div className="nav-prototype-utility"><a href="#">Subscribers</a><a href="#">Audit Log</a><a href="#">Admin</a></div>
  </nav>;
}

function VariantC() {
  return <nav className="nav-prototype-links variant-c-links">
    <a className="nav-prototype-home active" href="#"><i>◈</i><span>Dashboard</span></a>
    <div className="nav-prototype-collapsible open"><button><span>Service Operations</span><b>⌃</b></button>{dailyLinks.slice(1).map(([icon, label, badge]) => <a href="#" key={label}><i>{icon}</i><span>{label}</span>{badge ? <b>{badge}</b> : null}</a>)}</div>
    <div className="nav-prototype-collapsible"><button><span>Specialist Operations</span><b>›</b></button></div>
    <div className="nav-prototype-collapsible"><button><span>Compliance & Assessment</span><b>›</b></button></div>
    <div className="nav-prototype-c-footer"><a href="#">⚙ Settings</a><a href="#">? Help</a></div>
  </nav>;
}

function ChangelogPopover({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div className="nav-prototype-overlay" role="presentation" onClick={onClose}>
    <section className="nav-prototype-changelog" role="dialog" aria-modal="true" aria-labelledby="prototype-changelog-title" onClick={(event) => event.stopPropagation()}>
      <button className="nav-prototype-close" onClick={onClose} aria-label="Close changelog">×</button>
      <span className="prototype-kicker">OnBoard release notes</span>
      <h2 id="prototype-changelog-title">What’s new in v1.5.23</h2>
      <p className="nav-prototype-changelog-date">August 12, 2026</p>
      <ul><li>Service Operations workspace groups messaging and service-risk monitoring.</li><li>Fixed Route and On-Demand monitoring now share one risk workspace.</li><li>Expanded role-aware navigation keeps specialist tools separate.</li></ul>
      <a className="nav-prototype-full-changelog" href="#">View full changelog →</a>
    </section>
  </div>;
}

function PrototypeSwitcher({ variant, onCycle, onSelect }: { variant: VariantKey; onCycle: (direction: number) => void; onSelect: (variant: VariantKey) => void }) {
  const current = VARIANTS.find((item) => item.key === variant)!;
  return <div className="nav-prototype-switcher" aria-label="Prototype variant switcher"><button onClick={() => onCycle(-1)} aria-label="Previous variant">←</button><label><small>PROTOTYPE</small><select value={variant} onChange={(event) => onSelect(event.target.value as VariantKey)}>{VARIANTS.map((item) => <option value={item.key} key={item.key}>{item.key.toUpperCase()} — {item.label}</option>)}</select><span>Use ← → keys</span></label><button onClick={() => onCycle(1)} aria-label="Next variant">→</button><em>{current.key.toUpperCase()}</em></div>;
}
