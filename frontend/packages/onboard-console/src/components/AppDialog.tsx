import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";

type DialogOptions = { title: string; description?: string; confirmLabel?: string; danger?: boolean };
type PromptOptions = DialogOptions & { label: string; defaultValue?: string; placeholder?: string; multiline?: boolean; required?: boolean };
type Pending =
  | ({ kind: "confirm"; resolve: (value: boolean) => void } & DialogOptions)
  | ({ kind: "prompt"; resolve: (value: string | null) => void } & PromptOptions);

type DialogApi = { confirm: (options: DialogOptions) => Promise<boolean>; prompt: (options: PromptOptions) => Promise<string | null> };
const DialogContext = createContext<DialogApi | null>(null);

export function AppDialogProvider({ children }: PropsWithChildren) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const confirm = useCallback((options: DialogOptions) => new Promise<boolean>((resolve) => { const next: Pending = { ...options, kind: "confirm", resolve }; pendingRef.current = next; setPending(next); }), []);
  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>((resolve) => { const next: Pending = { ...options, kind: "prompt", resolve }; pendingRef.current = next; setPending(next); }), []);
  const finish = useCallback((value: boolean | string | null) => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    current?.resolve(value as never);
  }, []);

  return <DialogContext.Provider value={{ confirm, prompt }}>{children}{pending && <Dialog pending={pending} onFinish={finish} />}</DialogContext.Provider>;
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

  useEffect(() => { field.current?.focus(); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onFinish(pending.kind === "confirm" ? false : null); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onFinish, pending.kind]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.kind === "prompt") {
      if (pending.required && !value.trim()) { setShowRequired(true); return; }
      onFinish(value.trim());
    } else onFinish(true);
  }

  return <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onFinish(pending.kind === "confirm" ? false : null); }}>
    <form className={`modal-card${pending.danger ? " is-danger" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
      <div className="modal-card-header"><div><span className="eyebrow">OnBoard</span><h2 id={titleId}>{pending.title}</h2></div><button className="btn-icon" type="button" aria-label="Close dialog" onClick={() => onFinish(pending.kind === "confirm" ? false : null)}>×</button></div>
      {pending.description && <p className="modal-description">{pending.description}</p>}
      {pending.kind === "prompt" && <label className="modal-field">{pending.label}{pending.multiline ? <textarea ref={field as React.RefObject<HTMLTextAreaElement>} value={value} placeholder={pending.placeholder} onChange={(event) => { setValue(event.target.value); setShowRequired(false); }} /> : <input ref={field as React.RefObject<HTMLInputElement>} value={value} placeholder={pending.placeholder} onChange={(event) => { setValue(event.target.value); setShowRequired(false); }} />}{showRequired && <span className="event-field-error">This field is required.</span>}</label>}
      <div className="modal-actions"><button className="btn-sm" type="button" onClick={() => onFinish(pending.kind === "confirm" ? false : null)}>Cancel</button><button className={pending.danger ? "btn-sm danger" : "btn-primary"} type="submit">{pending.confirmLabel ?? (pending.kind === "confirm" ? "Continue" : "Save")}</button></div>
    </form>
  </div>;
}
