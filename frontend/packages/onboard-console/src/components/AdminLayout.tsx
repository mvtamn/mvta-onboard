import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useOutletContext } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { AdminIcon, shortcutLabel } from "./AdminIcon.js";
import { AdminQuickFind } from "./AdminQuickFind.js";
import { findCurrent, visibleAreas, type AdminArea } from "./adminNav.js";
import "./adminNav.css";

// Administration has no menu of its own beside the page. The home page lists
// every area; inside a page the breadcrumb names the area and opens a switcher
// to the others; a page split across routes shows them as tabs; and quick find
// (Cmd/Ctrl+K) reaches any page or tab by name. All four read adminNav.ts.

export interface AdminOutletContext {
  areas: AdminArea[];
  openQuickFind: () => void;
}

export function useAdminNav(): AdminOutletContext {
  return useOutletContext<AdminOutletContext>();
}

export function AdminLayout() {
  const { roles } = useAuth();
  const { pathname } = useLocation();
  const areas = useMemo(() => visibleAreas(roles), [roles]);
  const current = findCurrent(areas, pathname);
  const [findOpen, setFindOpen] = useState(false);
  const openQuickFind = useCallback(() => setFindOpen(true), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setFindOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => { setFindOpen(false); }, [pathname]);
  // On a narrow screen the tab strip scrolls; bring the current tab into it.
  const tabsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const strip = tabsRef.current;
    const tab = strip?.querySelector<HTMLElement>("a.active");
    if (!strip || !tab) return;
    if (tab.offsetLeft < strip.scrollLeft || tab.offsetLeft + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = tab.offsetLeft - 16;
    }
  }, [pathname]);

  return (
    <div className="admin-shell">
      {current ? (
        <div className="admin-pagebar">
          <div className="admin-crumbs">
            <nav aria-label="Breadcrumb">
              <ol>
                <li><Link to="/admin">Administration</Link></li>
                <li><AreaSwitcher areas={areas} currentArea={current.area.id} pathname={pathname} onFind={openQuickFind} /></li>
                <li><span aria-current={current.page.tabs ? undefined : "page"}>{current.page.label}</span></li>
              </ol>
            </nav>
            <button type="button" className="admin-find-btn" onClick={openQuickFind} aria-label="Find a page or tab">
              <AdminIcon name="search" size={15} />
              <span>Find</span>
              <kbd>{shortcutLabel()}</kbd>
            </button>
          </div>
          {current.page.tabs ? (
            <nav className="admin-tabs" aria-label={current.page.label} ref={tabsRef}>
              {current.page.tabs.map((tab) => (
                <NavLink key={tab.to} to={tab.to} end={tab.end}>
                  {tab.label}
                </NavLink>
              ))}
            </nav>
          ) : null}
        </div>
      ) : null}
      <section className="admin-layout-content"><Outlet context={{ areas, openQuickFind }} /></section>
      {findOpen ? <AdminQuickFind areas={areas} onClose={() => setFindOpen(false)} /> : null}
    </div>
  );
}

function AreaSwitcher({ areas, currentArea, pathname, onFind }: { areas: readonly AdminArea[]; currentArea: string; pathname: string; onFind: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const area = areas.find((candidate) => candidate.id === currentArea);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="admin-switcher" ref={rootRef}>
      <button ref={buttonRef} type="button" className="admin-switcher-btn" aria-expanded={open} aria-controls="admin-switcher-panel" onClick={() => setOpen((value) => !value)}>
        {area?.name}
        <AdminIcon name="chevronDown" size={14} />
      </button>
      {open ? (
        <div className="admin-switcher-panel" id="admin-switcher-panel">
          <div className="admin-switcher-grid">
            {areas.map((candidate) => (
              <div key={candidate.id} className="admin-switcher-area">
                <span className="admin-switcher-name">{candidate.name}</span>
                {candidate.pages.map((page) => {
                  const here = findCurrent([candidate], pathname)?.page.to === page.to;
                  return <Link key={page.to} to={page.to} className={here ? "active" : undefined} aria-current={here ? "page" : undefined}>{page.label}</Link>;
                })}
              </div>
            ))}
          </div>
          <div className="admin-switcher-foot">
            <button type="button" className="admin-link-btn" onClick={() => { setOpen(false); onFind(); }}>
              <AdminIcon name="search" size={14} />Find a page or tab
            </button>
            <Link to="/admin">All of Administration</Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
