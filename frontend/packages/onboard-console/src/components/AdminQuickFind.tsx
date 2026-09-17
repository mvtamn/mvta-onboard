import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AdminIcon } from "./AdminIcon.js";
import { quickFindEntries, searchQuickFind, type AdminArea } from "./adminNav.js";

// Every Administration page and tab by name. Only what the signed-in roles can
// open is listed, so a result never leads to a page that refuses them.
export function AdminQuickFind({ areas, onClose }: { areas: readonly AdminArea[]; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const entries = useMemo(() => quickFindEntries(areas), [areas]);
  const results = useMemo(() => searchQuickFind(entries, query), [entries, query]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => opener?.focus?.();
  }, []);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, listId]);

  function open(index: number) {
    const entry = results[index];
    if (!entry) return;
    onClose();
    navigate(entry.to);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => (results.length ? (i + 1) % results.length : 0)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0)); }
    else if (event.key === "Enter") { event.preventDefault(); open(active); }
    // The dialog holds one control, so Tab has nowhere else to go.
    else if (event.key === "Tab") event.preventDefault();
  }

  const pages = results.filter((entry) => entry.kind === "page");
  const tabs = results.filter((entry) => entry.kind === "tab");

  const row = (entry: (typeof results)[number]) => {
    const index = results.indexOf(entry);
    return (
      <li
        key={`${entry.kind}:${entry.to}`}
        id={`${listId}-${index}`}
        role="option"
        aria-selected={index === active}
        className={`aqf-row${index === active ? " is-active" : ""}`}
        onMouseMove={() => setActive(index)}
        onClick={() => open(index)}
      >
        <span className="aqf-icon"><AdminIcon name={entry.icon} size={17} /></span>
        <span className="aqf-text"><b>{entry.label}</b><small>{entry.context}</small></span>
        {index === active ? <kbd className="aqf-kbd">Enter</kbd> : null}
      </li>
    );
  };

  return (
    <div className="aqf-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="aqf" role="dialog" aria-modal="true" aria-label="Find in Administration" onKeyDown={onKeyDown}>
        <div className="aqf-field">
          <AdminIcon name="search" size={19} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a page or tab"
            aria-label="Find a page or tab"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="aqf-kbd">Esc</kbd>
        </div>
        <ul className="aqf-list" id={listId} role="listbox" aria-label="Results">
          {pages.length ? <li className="aqf-heading" role="presentation">{query.trim() ? "Pages" : "All pages"}</li> : null}
          {pages.map(row)}
          {tabs.length ? <li className="aqf-heading" role="presentation">Tabs inside a page</li> : null}
          {tabs.map(row)}
          {!results.length ? <li className="aqf-empty" role="presentation">No page or tab is called that. Try one word from its name.</li> : null}
        </ul>
        <div className="aqf-foot" aria-hidden="true"><span>↑ ↓ to move</span><span>Enter to open</span><span>Esc to close</span></div>
      </div>
    </div>
  );
}
