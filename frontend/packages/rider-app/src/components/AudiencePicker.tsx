import { useMemo, useState } from "react";
import type { RiderPreferenceOption } from "@mvta/shared";

export type Mode = "all" | "some";

// "Every route" or "only these", on the subscribe form and the preference page.
// "Only these" with nothing ticked is never read as "every route": both forms
// refuse it, and so does the server.
//
// Two looks, because the two pages already differ: the subscribe form asks each
// question as a section with segmented choices, the preference page as a field
// with radio rows.
//
// The list is searchable and says how many are chosen. MVTA runs enough routes
// that an unfiltered column of checkboxes is a scroll-and-hunt, and a rider who
// has scrolled past their ticks cannot otherwise tell how many they have.
export function AudiencePicker(props: {
  legend: string;
  name: string;
  allLabel: string;
  someLabel: string;
  listLabel: string;
  options: RiderPreferenceOption[];
  mode: Mode;
  chosen: Set<string>;
  dropped?: string[];
  droppedNote?: string;
  /** Shown under the choice - for instance, why "only these" can't be picked right now. */
  note?: string;
  someDisabled?: boolean;
  variant?: "field" | "section";
  /** Below this many options, searching costs a control and saves nothing. */
  searchFrom?: number;
  searchPlaceholder?: string;
  onMode: (mode: Mode) => void;
  onToggle: (id: string) => void;
  onClear?: () => void;
}) {
  const section = props.variant === "section";
  const [query, setQuery] = useState("");
  const searchable = props.options.length >= (props.searchFrom ?? 8);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return props.options;
    return props.options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [props.options, query]);

  const chosenCount = props.options.filter((option) => props.chosen.has(option.id)).length;
  const choices: { mode: Mode; label: string; disabled: boolean }[] = [
    { mode: "all", label: props.allLabel, disabled: false },
    { mode: "some", label: props.someLabel, disabled: Boolean(props.someDisabled) },
  ];

  return (
    <fieldset className={section ? "section" : "field"}>
      <legend className={section ? "section-title" : undefined}>{props.legend}</legend>
      <div className={section ? "segments two" : "radios"}>
        {choices.map((choice) => (
          <label key={choice.mode} className={section ? "segment" : "check"}>
            <input
              type="radio"
              name={props.name}
              checked={props.mode === choice.mode}
              disabled={choice.disabled}
              onChange={() => props.onMode(choice.mode)}
            />
            {section ? <span>{choice.label}</span> : choice.label}
          </label>
        ))}
      </div>
      {props.note && <p className="note">{props.note}</p>}
      {(props.dropped?.length ?? 0) > 0 && props.droppedNote && <p className="note">{props.droppedNote}</p>}
      {props.mode === "some" && (
        <>
          {searchable && (
            <div className="list-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4f4f4f" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.2-3.2" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={props.searchPlaceholder ?? `Search ${props.listLabel.toLowerCase()}`}
                aria-label={`Search ${props.listLabel.toLowerCase()}`}
              />
            </div>
          )}
          <div className="checks list" role="group" aria-label={props.listLabel}>
            {shown.map((option) => (
              <label key={option.id} className="check">
                <input type="checkbox" checked={props.chosen.has(option.id)} onChange={() => props.onToggle(option.id)} />
                {section ? <span>{option.label}</span> : option.label}
              </label>
            ))}
            {shown.length === 0 && <p className="list-empty">Nothing matches “{query.trim()}”.</p>}
          </div>
          <div className="list-tools">
            <span>
              {chosenCount === 0
                ? "None chosen yet"
                : chosenCount === 1
                  ? "1 chosen"
                  : `${chosenCount} chosen`}
            </span>
            {props.onClear && chosenCount > 0 && (
              <button type="button" className="link-btn" onClick={props.onClear}>
                Clear selection
              </button>
            )}
          </div>
        </>
      )}
    </fieldset>
  );
}
