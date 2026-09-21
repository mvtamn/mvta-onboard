// Administration > Access & Identity > Roles (ADR-0032, increment 4).
//
// A Role is a name, a purpose an Access Administrator writes, and a grid of
// Module Actions. What it grants is the grid; the Access Summary beside it is
// generated from that grid - here as a preview while the boxes are being
// ticked, and by the server on every read - so a role's description can never
// drift from what the role actually allows.
//
// The rules the server keeps are explained here rather than discovered through
// errors: a locked role is shown read-only, System Administrator's wildcard is
// described instead of drawn as checkboxes, Access & Identity actions are not
// offered because granting them is a Privileged Access Change (increment 5),
// and a role people still hold cannot be archived out from under them.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, type AccessCatalogModule, type AccessRoleHistoryEntry, type AccessRoleView } from "@mvta/shared";
import { api } from "../../config.js";
import { useAccess as useMyAccess } from "../../auth/AccessContext.js";
import { Icon, Loading, PageHead, Pill } from "./AccessUi.js";
import { displayTime, errorMessage, useAccess } from "./accessData.js";

/** The module whose actions no ordinary role may be given (ADR-0032). */
export const ACCESS_MODULE = "access-identity";
const VIEW = "view";

const PRIVILEGED_NOTE =
  "Granting access management is a Privileged Access Change: it needs a second Access Administrator, which OnBoard cannot record yet. Ask for the Access Administrator role instead of adding these actions to another role.";

export const actionKey = (moduleKey: string, action: string) => `${moduleKey}.${action}`;

/**
 * The Access Summary, written the way the server writes it: one line per
 * module the holder can open, in catalog order. A module granted an action
 * without `view` still gets a line, marked, because that is a mistake worth
 * seeing before it is saved.
 */
export function roleSummaryLines(modules: readonly AccessCatalogModule[], actions: Iterable<string>): string[] {
  const held = new Set(actions);
  const lines: string[] = [];
  for (const module of modules) {
    const canView = held.has(actionKey(module.key, VIEW));
    const labels = module.actions
      .filter((action) => action.key !== VIEW && held.has(actionKey(module.key, action.key)))
      .map((action) => action.label);
    if (!canView && labels.length === 0) continue;
    if (!canView) lines.push(`${module.label}: ${labels.join("; ")} (cannot open the page)`);
    else if (labels.length === 0) lines.push(`${module.label}: view only`);
    else lines.push(`${module.label}: view; ${labels.join("; ")}`);
  }
  return lines;
}

/** What one history entry changed, in the reader's words rather than in keys. */
export function actionsChanged(entry: AccessRoleHistoryEntry): { added: string[]; removed: string[] } {
  const before = new Set(entry.before?.actions ?? []);
  const after = new Set(entry.after?.actions ?? []);
  return {
    added: [...after].filter((action) => !before.has(action)).sort(),
    removed: [...before].filter((action) => !after.has(action)).sort(),
  };
}

interface Draft {
  name: string;
  purpose: string;
  actions: string[];
}

const draftOf = (role: AccessRoleView): Draft => ({ name: role.name, purpose: role.purpose, actions: [...role.actions].sort() });
const BLANK: Draft = { name: "", purpose: "", actions: [] };
const same = (a: Draft, b: Draft) =>
  a.name.trim() === b.name.trim() && a.purpose.trim() === b.purpose.trim() && a.actions.join("|") === b.actions.join("|");

const changeLabel: Record<string, string> = { created: "Created", updated: "Edited", archived: "Archived" };

export function AccessRoles() {
  const { busy, setBusy, setError, setNotice } = useAccess();
  const { can } = useMyAccess();
  const canManage = can("access-identity.manage");

  const [modules, setModules] = useState<AccessCatalogModule[]>([]);
  const [roles, setRoles] = useState<AccessRoleView[]>([]);
  const [loading, setLoading] = useState(true);
  // The API answers 503 until migrations 129 and 130 are applied. That is a
  // state of the environment, not a failure of this page, so it is shown as
  // itself rather than as a red error.
  const [notReady, setNotReady] = useState<string | null>(null);
  // An empty list means one of two different things, and saying the wrong one
  // invites somebody to define a role that is already there.
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [history, setHistory] = useState<AccessRoleHistoryEntry[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catalog, list] = await Promise.all([api.getAccessCatalog(), api.getAccessRoles()]);
      setModules(catalog.modules);
      setRoles(list.roles);
      setNotReady(null);
      setLoadFailed(false);
    } catch (loadError) {
      if (loadError instanceof ApiError && loadError.status === 503) {
        setNotReady(loadError.message);
        setModules([]);
        setRoles([]);
      } else {
        setError(errorMessage(loadError, "The roles could not be read."));
        setLoadFailed(true);
      }
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => { void load(); }, [load]);

  const selected = creating ? null : roles.find((role) => role.key === selectedKey) ?? null;
  const baseline = creating ? BLANK : selected ? draftOf(selected) : BLANK;
  const editable = canManage && (creating || (!!selected && !selected.locked && !selected.allActions && !selected.archived));
  const dirty = !same(draft, baseline);
  const canSave = editable && dirty && draft.name.trim().length > 0;
  const previewLines = roleSummaryLines(modules, draft.actions);

  function open(role: AccessRoleView) {
    setCreating(false);
    setSelectedKey(role.key);
    setDraft(draftOf(role));
    setHistory(null);
    void api
      .getAccessRoleHistory(role.key)
      .then((result) => setHistory(result.history))
      .catch(() => setHistory([]));
  }

  function startNew() {
    setCreating(true);
    setSelectedKey(null);
    setDraft(BLANK);
    setHistory(null);
  }

  function close() {
    setCreating(false);
    setSelectedKey(null);
    setDraft(BLANK);
    setHistory(null);
  }

  function toggle(key: string, on: boolean) {
    setDraft((current) => ({
      ...current,
      actions: (on ? [...current.actions, key] : current.actions.filter((action) => action !== key)).sort(),
    }));
  }

  async function save() {
    setBusy(true);
    try {
      const input = { name: draft.name.trim(), purpose: draft.purpose.trim(), actions: draft.actions };
      const result = creating ? await api.createAccessRole(input) : await api.updateAccessRole(selected!.key, input);
      setNotice(creating ? `${result.role.name} was created.` : `${result.role.name} was saved.`);
      setCreating(false);
      setSelectedKey(result.role.key);
      setDraft(draftOf(result.role));
      await load();
      const fresh = await api.getAccessRoleHistory(result.role.key).catch(() => ({ history: [] }));
      setHistory(fresh.history);
    } catch (saveError) {
      setError(errorMessage(saveError, "The role could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function setArchived(role: AccessRoleView, archived: boolean) {
    setBusy(true);
    try {
      const result = await api.setAccessRoleArchived(role.key, archived);
      setNotice(`${result.role.name} was ${archived ? "archived" : "restored"}.`);
      setDraft(draftOf(result.role));
      await load();
    } catch (archiveError) {
      setError(errorMessage(archiveError, `The role could not be ${archived ? "archived" : "restored"}.`));
    } finally {
      setBusy(false);
    }
  }

  const sections = useMemo(() => {
    const bySection = new Map<string, AccessCatalogModule[]>();
    for (const module of modules) {
      const list = bySection.get(module.section);
      if (list) list.push(module);
      else bySection.set(module.section, [module]);
    }
    return [...bySection.entries()];
  }, [modules]);

  const head = <PageHead
    title="Roles"
    description="A role is a name, a purpose, and the Module Actions it grants. OnBoard holds them now, not Microsoft Entra: adding a role is a change here, and it takes effect within minutes rather than at the next sign-in."
    actions={canManage && !notReady ? <button type="button" className="am-btn primary" disabled={busy} onClick={startNew}><Icon name="userPlus" />New role</button> : undefined}
  />;

  if (notReady) {
    return <>{head}
      <p className="am-callout attn" role="status"><Icon name="warn" /><span><b>Roles are not set up in this environment yet.</b> {notReady}</span></p>
    </>;
  }

  if (loading && roles.length === 0) return <>{head}<Loading label="Loading roles…" /></>;

  return <>
    {head}

    <section className="am-card" aria-labelledby="am-roles-title">
      <div className="am-card-head">
        <h3 id="am-roles-title">Roles</h3>
        <span>{roles.length} {roles.length === 1 ? "role" : "roles"} · the Access Summary is generated from the grid</span>
      </div>
      {roles.length === 0
        ? <p className="am-empty">{loadFailed ? "The roles could not be read, so nothing is listed here." : "No roles are defined yet."}</p>
        : <div className="am-table-wrap flush">
          <table className="am-table">
            <thead><tr><th>Role</th><th>What it grants</th><th className="num">People</th></tr></thead>
            <tbody>{roles.map((role) => <tr key={role.key} className={role.key === selectedKey ? "is-selected" : undefined}>
              <td>
                <button type="button" className="am-name" onClick={() => open(role)}>{role.name}</button>
                <div className="am-stack">
                  {role.locked ? <Pill tone="warn" icon="lock">Locked</Pill> : null}
                  {role.seeded ? <Pill tone="mute">Built in</Pill> : null}
                  {role.archived ? <Pill tone="mute">Archived</Pill> : null}
                </div>
                <small className="am-muted">{role.purpose || "No purpose recorded."}</small>
              </td>
              <td>
                {role.allActions ? <span>Everything outside Access &amp; Identity, including capabilities added later.</span> : null}
                <ul className="am-lines">{role.summary.length
                  ? role.summary.map((line) => <li key={line}>{line}</li>)
                  : <li className="am-muted">Grants nothing yet.</li>}</ul>
              </td>
              <td className="num">{role.members}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>

    {creating || selected ? <section className="am-card" aria-labelledby="am-role-detail-title">
      <div className="am-card-head">
        <h3 id="am-role-detail-title">{creating ? "New role" : selected!.name}</h3>
        <button type="button" className="am-btn ghost sm" onClick={close}>Close</button>
      </div>

      <div className="am-detail-sec">
        {!creating && selected!.locked
          ? <p className="am-callout" role="note"><Icon name="lock" /><span><b>{selected!.name} is a locked role.</b> OnBoard depends on it: what it grants, its name and its purpose cannot be changed, and it cannot be archived. It is shown here read-only so its grid can be read against the others.</span></p>
          : null}
        {!creating && selected!.archived
          ? <p className="am-callout" role="note"><Icon name="info" /><span><b>This role is archived.</b> Nobody can be given it. Restore it before editing.</span></p>
          : null}
        {!canManage
          ? <p className="am-callout" role="note"><Icon name="info" /><span>You can read roles but not change them. Editing a role needs the Access Administrator role.</span></p>
          : null}

        <div className="am-fields">
          <label className="am-field">Role name
            <input className="am-input" value={draft.name} disabled={!editable || busy} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
            <span className="am-hint">{creating ? "People see this name wherever access is granted." : "Renaming a role does not change who holds it."}</span>
          </label>
          <label className="am-field">Purpose
            <textarea className="am-input" value={draft.purpose} disabled={!editable || busy} onChange={(event) => setDraft((current) => ({ ...current, purpose: event.target.value }))} />
            <span className="am-hint">Why this role exists, in your words. The Access Summary below is written by OnBoard and is not edited by hand.</span>
          </label>
        </div>
      </div>

      <div className="am-detail-sec">
        <h4>Module actions</h4>
        {!creating && selected!.allActions
          ? <p className="am-callout" role="note"><Icon name="info" /><span><b>This role holds every action outside Access &amp; Identity.</b> It is not a list of ticked boxes: a module added to OnBoard later is included automatically, which is why it is stored as one standing rule. Managing access stays separate, and is granted by the Access Administrator role.</span></p>
          : <>
            {sections.map(([section, sectionModules]) => <div key={section}>
              <p className="am-group-label">{section}</p>
              <div className="am-mods">{sectionModules.map((module) => {
                const privileged = module.key === ACCESS_MODULE;
                // Access & Identity boxes are not offered on an ordinary role:
                // the server refuses adding them (409) and this is where
                // someone would look for them.
                const readOnly = !editable || privileged;
                return <div key={module.key} className="am-mod">
                  <b>{module.label}</b>
                  {privileged && (creating || !selected!.locked)
                    ? <p className="am-fine">{PRIVILEGED_NOTE}</p>
                    : <div className="am-acts">{module.actions.map((action) => {
                      const key = actionKey(module.key, action.key);
                      return <label key={key} className={`am-act${readOnly ? " is-read" : ""}`}>
                        <input type="checkbox" checked={draft.actions.includes(key)} disabled={readOnly || busy} onChange={(event) => toggle(key, event.target.checked)} />
                        <span>{action.label}</span>
                      </label>;
                    })}</div>}
                </div>;
              })}</div>
            </div>)}
          </>}
      </div>

      <div className="am-detail-sec">
        <h4>Access summary {editable && dirty ? <span className="am-muted">preview</span> : null}</h4>
        <p className="am-fine">Generated by OnBoard from the grid above, every time a role is read. It cannot be written by hand, so it cannot drift from what the role allows.</p>
        <ul className="am-lines" aria-label="Access summary">{previewLines.length
          ? previewLines.map((line) => <li key={line}>{line}</li>)
          : <li className="am-muted">{!creating && selected!.allActions ? "Everything outside Access & Identity." : "This role grants nothing yet."}</li>}</ul>
      </div>

      <div className="am-detail-sec">
        <div className="am-toolbar">
          <button type="button" className="am-btn primary" disabled={!canSave || busy} onClick={() => void save()}><Icon name="check" size={15} />{creating ? "Create role" : "Save changes"}</button>
          {dirty && editable ? <button type="button" className="am-btn" disabled={busy} onClick={() => setDraft(baseline)}>Discard changes</button> : null}
          {!creating && canManage && !selected!.locked
            ? selected!.archived
              ? <button type="button" className="am-btn" disabled={busy} onClick={() => void setArchived(selected!, false)}>Restore role</button>
              : <button type="button" className="am-btn" disabled={busy || selected!.members > 0} onClick={() => void setArchived(selected!, true)}>Archive role</button>
            : null}
          <span className="am-toolbar-meta">{!creating && selected!.members > 0
            ? `Held by ${selected!.members} ${selected!.members === 1 ? "person" : "people"}${selected!.archived ? "." : " — remove it from them before archiving."}`
            : creating ? "Nothing is saved until you create the role." : "Nobody holds this role."}</span>
        </div>
        {!editable && canManage && !creating ? <p className="am-fine">{selected!.locked ? "Locked roles are read-only." : selected!.archived ? "Restore this role to edit it." : "This role is not editable."}</p> : null}
      </div>

      {!creating ? <div className="am-detail-sec">
        <h4>History</h4>
        {history === null
          ? <p className="am-empty">Loading history…</p>
          : history.length === 0
            ? <p className="am-empty">No changes recorded for this role.</p>
            : <ul className="am-feed">{history.map((entry, index) => {
              const { added, removed } = actionsChanged(entry);
              const renamed = entry.before && entry.after && entry.before.name !== entry.after.name;
              const repurposed = entry.before && entry.after && entry.before.purpose !== entry.after.purpose;
              return <li key={`${entry.occurredAt}-${index}`}>
                <span className="am-dot" />
                <span><b>{entry.actorName ?? "An unrecorded account"}</b> · {changeLabel[entry.change] ?? entry.change}
                  {added.length ? <> · added <span className="am-mono">{added.join(", ")}</span></> : null}
                  {removed.length ? <> · removed <span className="am-mono">{removed.join(", ")}</span></> : null}
                  {renamed ? <> · renamed from {entry.before!.name}</> : null}
                  {repurposed && !added.length && !removed.length && !renamed ? <> · purpose rewritten</> : null}
                </span>
                <small>{displayTime(entry.occurredAt)}</small>
              </li>;
            })}</ul>}
      </div> : null}
    </section> : null}
  </>;
}
