import { useCallback, useEffect, useState } from "react";
import type { DecisionMatrixLibraryEntry, DecisionMatrixLibraryDiagnostics } from "@mvta/shared";
import { ApiError } from "@mvta/shared";
import { api } from "../config.js";

/**
 * What choosing a document in SharePoint tells a Draft save: which item, and
 * the version the picker showed.
 *
 * The site, drive, name, file type and link are not here. The server reads
 * them from the Approved Document Library when the Draft is saved, so a
 * reference cannot name a library OnBoard did not choose, and a document that
 * changed after it was picked is refused rather than recorded at a version
 * nobody saw.
 */
export interface ChosenDocument {
  item_id: string;
  seen_version: string;
  /** For showing a person what they picked; the server records SharePoint's own name. */
  file_name: string;
  /** Where it sits in the library, for showing a person what they picked. */
  path: string;
}

type PickerState =
  | { status: "loading" }
  | { status: "listing"; entries: DecisionMatrixLibraryEntry[]; diagnostics: DecisionMatrixLibraryDiagnostics }
  | { status: "unusable"; reason: string; outcome: DecisionMatrixLibraryDiagnostics["outcome"] | "signed_out" };

/** "" is the library root, which reads better as a name than as an empty crumb. */
function crumbsFor(path: string): Array<{ label: string; path: string }> {
  const crumbs = [{ label: "Library", path: "" }];
  let walked = "";
  for (const segment of path.split("/").filter(Boolean)) {
    walked = walked ? `${walked}/${segment}` : segment;
    crumbs.push({ label: segment, path: walked });
  }
  return crumbs;
}

function describe(entry: DecisionMatrixLibraryEntry): string {
  if (entry.kind === "folder") {
    if (entry.child_count === null) return "Folder";
    return entry.child_count === 1 ? "1 item" : `${entry.child_count} items`;
  }
  const size = entry.size_bytes === null ? null : entry.size_bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(entry.size_bytes / 1024))} KB`
    : `${(entry.size_bytes / (1024 * 1024)).toFixed(1)} MB`;
  const changed = entry.last_modified_at ? new Date(entry.last_modified_at).toLocaleDateString() : null;
  return [size, changed && `changed ${changed}`].filter(Boolean).join(" · ") || "Document";
}

/**
 * A document cannot be chosen without a version: the save compares it with
 * what SharePoint reports then, and there would be nothing to compare. The
 * rest the server reads for itself, and refuses if SharePoint cannot say.
 */
export function missingFacts(entry: DecisionMatrixLibraryEntry): string[] {
  return entry.etag ? [] : ["a version"];
}

/**
 * The folder a chosen document sits in. Showing the whole path under the file
 * name repeats the name back at the reader; what they want to confirm is which
 * folder it came from.
 */
export function folderOf(path: string): string {
  const segments = path.split("/").filter(Boolean);
  segments.pop();
  return segments.length ? segments.join("/") : "Library root";
}

export function DocumentPicker({ onChoose, onCancel }: { onChoose: (chosen: ChosenDocument) => void; onCancel?: () => void }) {
  const [path, setPath] = useState("");
  const [state, setState] = useState<PickerState>({ status: "loading" });

  const load = useCallback(async (next: string) => {
    setState({ status: "loading" });
    try {
      const result = await api.getDecisionMatrixLibrary(next || undefined);
      if (result.diagnostics.outcome !== "ok") {
        setState({ status: "unusable", outcome: result.diagnostics.outcome, reason: result.diagnostics.reason ?? "The approved SharePoint library could not be read." });
        return;
      }
      setState({ status: "listing", entries: result.entries, diagnostics: result.diagnostics });
    } catch (error) {
      // A lapsed sign-in is not the library's fault, and saying so here would
      // send an Admin to SharePoint instead of back to sign in.
      const signedOut = error instanceof ApiError && error.status === 401;
      setState({
        status: "unusable",
        outcome: signedOut ? "signed_out" : "failed",
        // The heading names the condition, so the reason says what to do about
        // it rather than repeating the sentence back.
        reason: signedOut
          ? "Reload the page to sign in again."
          : error instanceof ApiError ? error.message : "The approved SharePoint library could not be read.",
      });
    }
  }, []);

  useEffect(() => { void load(path); }, [load, path]);

  function choose(entry: DecisionMatrixLibraryEntry) {
    onChoose({ item_id: entry.item_id, seen_version: entry.etag ?? "", file_name: entry.name, path: entry.path });
  }

  return <div className="dmx-picker">
    <nav className="dmx-picker-crumbs" aria-label="Library folder">
      {crumbsFor(path).map((crumb, index, all) => <span key={crumb.path || "root"}>
        {index > 0 ? <span aria-hidden="true"> / </span> : null}
        {index === all.length - 1
          ? <span aria-current="location">{crumb.label}</span>
          : <button type="button" className="btn-sm" onClick={() => setPath(crumb.path)}>{crumb.label}</button>}
      </span>)}
    </nav>

    {state.status === "loading" ? <p className="dmx-empty" role="status">Reading the library…</p> : null}

    {state.status === "unusable" ? <div className={state.outcome === "failed" ? "dmx-state dmx-state-error" : "dmx-state dmx-state-warning"} role={state.outcome === "failed" ? "alert" : "status"}>
      <strong>{
        state.outcome === "not_configured" ? "No approved library is configured."
          : state.outcome === "forbidden" ? "OnBoard cannot read this library."
            : state.outcome === "not_found" ? "That folder is not there."
              : state.outcome === "signed_out" ? "Your sign-in has expired."
                : "The library could not be read."
      }</strong> {state.reason}
      {state.outcome === "not_found" && path ? <> <button type="button" className="btn-sm" onClick={() => setPath("")}>Back to the library root</button></> : null}
    </div> : null}

    {state.status === "listing" ? (state.entries.length ? <ul className="dmx-picker-list">
      {state.entries.map((entry) => {
        const missing = entry.kind === "file" ? missingFacts(entry) : [];
        return <li key={entry.item_id} className={`dmx-picker-item ${entry.kind}`}>
          {entry.kind === "folder"
            ? <button type="button" className="dmx-picker-open" onClick={() => setPath(entry.path)}>
                <span className="dmx-picker-name">{entry.name}</span>
                <span className="dmx-meta">{describe(entry)}</span>
              </button>
            : <button
                type="button"
                className="dmx-picker-open"
                disabled={missing.length > 0}
                onClick={() => choose(entry)}
              >
                <span className="dmx-picker-name">{entry.name}</span>
                <span className="dmx-meta">{missing.length ? `SharePoint did not report ${missing.join(", ")} for this file` : describe(entry)}</span>
              </button>}
        </li>;
      })}
    </ul> : <p className="dmx-empty">This folder is empty.</p>) : null}

    {onCancel ? <button type="button" className="btn-sm" onClick={onCancel}>Cancel</button> : null}
  </div>;
}
