import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";

type DialogOptions = { title: string; description?: string; confirmLabel?: string; danger?: boolean };
type PromptOptions = DialogOptions & { label: string; defaultValue?: string; placeholder?: string; multiline?: boolean; required?: boolean };
/** One answer in a choice dialog: a button, with an optional line under it. */
export type DialogChoice<T extends string = string> = { value: T; label: string; description?: string };
// A fixed set of answers, each its own button, so nobody has to type a value
// the code then compares against (a typo used to do nothing at all).
type ChooseOptions<T extends string = string> = { title: string; description?: string; choices: DialogChoice<T>[]; current?: T | null };
type Pending =
  | ({ kind: "confirm"; resolve: (value: boolean) => void } & DialogOptions)
  | ({ kind: "prompt"; resolve: (value: string | null) => void } & PromptOptions)
  | ({ kind: "choose"; resolve: (value: string | null) => void } & ChooseOptions);

type DialogApi = {
  confirm: (options: DialogOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  choose: <T extends string>(options: ChooseOptions<T>) => Promise<T | null>;
};
const DialogContext = createContext<DialogApi | null>(null);

export function AppDialogProvider({ children }: PropsWithChildren) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const confirm = useCallback((options: DialogOptions) => new Promise<boolean>((resolve) => { const next: Pending = { ...options, kind: "confirm", resolve }; pendingRef.current = next; setPending(next); }), []);
  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => { const next: Pending = { ...options, kind: "prompt", resolve }; pendingRef.current = next; setPending(next); }), []);
  const choose = useCallback(<T extends string>(options: ChooseOptions<T>) => new Promise<T | null>((resolve) => {
    const next: Pending = { ...options, kind: "choose", resolve: resolve as (value: string | null) => void };
    pendingRef.current = next; setPending(next);
  }), []);
  const finish = useCallback((value: boolean | string | null) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(value as never);
  }, []);

  return <DialogContext.Provider value={{ confirm, prompt, choose }}>{children}{pending && <Dialog pending={pending} onFinish={finish} />}</DialogContext.Provider>;
}

export function useAppDialog() {
  const dialog = useContext(DialogContext);
  if (!dialog) throw new Error("useAppDialog must be used inside AppDialogProvider");
  return dialog;
}

function Dialog({ pending, onFinish }: { pending: Pending; onFinish: (value: boolean | string | null) => void }) {
  const [value, setValue] = useState(pending.kind === "prompt" ? pending.defaultValue ?? "" : "");
  const [showRequired, setShowRequired] = useState(false);
  const field = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const titleId = "app-dialog-title";
  const cancelValue = pending.kind === "confirm" ? false : null;

  useEffect(() => { field.current?.focus(); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onFinish(cancelValue); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onFinish, cancelValue]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.kind === "choose") return;
    if (pending.kind === "prompt") {
      if (pending.required && !value.trim()) { setShowRequired(true); return; }
      onFinish(value.trim());
    } else onFinish(true);
  }

  return <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onFinish(cancelValue); }}>
    <form className={`modal-card${pending.kind !== "choose" && pending.danger ? " is-danger" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
      <div className="modal-card-header"><div><span className="eyebrow">OnBoard</span><h2 id={titleId}>{pending.title}</h2></div><button className="btn-icon" type="button" aria-label="Close dialog" onClick={() => onFinish(cancelValue)}>×</button></div>
      {pending.description && <p className="modal-description">{pending.description}</p>}
      {pending.kind === "prompt" && <label className="modal-field">{pending.label}{pending.multiline ? <textarea ref={field as React.RefObject<HTMLTextAreaElement>} value={value} placeholder={pending.placeholder} onChange={(event) => { setValue(event.target.value); setShowRequired(false); }} /> : <input ref={field as React.RefObject<HTMLInputElement>} value={value} placeholder={pending.placeholder} onChange={(event) => { setValue(event.target.value); setShowRequired(false); }} />}{showRequired && <span className="event-field-error">This field is required.</span>}</label>}
      {pending.kind === "choose" && <div className="modal-choices" role="group" aria-label={pending.title} style={{ display: "grid", gap: 8, margin: "4px 0 12px" }}>
        {pending.choices.map((choice) => <button
          key={choice.value}
          type="button"
          className={choice.value === pending.current ? "btn-primary" : "btn-sm"}
          style={{ textAlign: "left", justifyContent: "flex-start" }}
          aria-describedby={choice.description ? `app-dialog-choice-${choice.value}` : undefined}
          onClick={() => onFinish(choice.value)}
        >
          <strong>{choice.label}</strong>
          {choice.description ? <span id={`app-dialog-choice-${choice.value}`} className="td-dim" style={{ display: "block", fontWeight: "normal" }}>{choice.description}</span> : null}
        </button>)}
      </div>}
      <div className="modal-actions"><button className="btn-sm" type="button" onClick={() => onFinish(cancelValue)}>Cancel</button>{pending.kind !== "choose" ? <button className={pending.danger ? "btn-sm danger" : "btn-primary"} type="submit">{pending.confirmLabel ?? (pending.kind === "confirm" ? "Continue" : "Save")}</button> : null}</div>
    </form>
  </div>;
}
