import type { RiderPreferenceOption } from "@mvta/shared";

export type Mode = "all" | "some";

// "Every route" or "only these", on the subscribe form and the preference page.
// "Only these" with nothing ticked is never read as "every route": both forms
// refuse it, and so does the server.
//
// Two looks, because the two pages already differ: the subscribe form asks each
// question as a section with segmented choices, the preference page as a field
// with radio rows.
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
  onMode: (mode: Mode) => void;
  onToggle: (id: string) => void;
}) {
  const section = props.variant === "section";
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
        <div className="checks list" role="group" aria-label={props.listLabel}>
          {props.options.map((option) => (
            <label key={option.id} className="check">
              <input type="checkbox" checked={props.chosen.has(option.id)} onChange={() => props.onToggle(option.id)} />
              {section ? <span>{option.label}</span> : option.label}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
