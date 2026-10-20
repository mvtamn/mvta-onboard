// PROTOTYPE ONLY - the floating bar that flips between ?variant= options on a
// page being prototyped. Renders nothing outside a dev build, so a stray merge
// cannot ship it.
import { useEffect, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";

export interface PrototypeVariant { key: string; name: string }

export function useVariant(variants: readonly PrototypeVariant[]): string {
  const [params] = useSearchParams();
  const key = params.get("variant") ?? variants[0].key;
  return variants.some((v) => v.key === key) ? key : variants[0].key;
}

export function PrototypeSwitcher({ variants }: { variants: readonly PrototypeVariant[] }) {
  const [params, setParams] = useSearchParams();
  const current = useVariant(variants);
  const index = variants.findIndex((v) => v.key === current);

  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length];
    const updated = new URLSearchParams(params);
    updated.set("variant", next.key);
    setParams(updated, { replace: true });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable]"))) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;
  const variant = variants[index];
  return <div role="toolbar" aria-label="Prototype variant" style={{
    position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
    display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 999,
    background: "#111", color: "#fff", boxShadow: "0 6px 24px rgba(0,0,0,.35)", font: "600 13px system-ui, sans-serif",
  }}>
    <button type="button" aria-label="Previous variant" onClick={() => go(-1)} style={arrow}>←</button>
    <span style={{ minWidth: 220, textAlign: "center" }}>PROTOTYPE · {variant.key} — {variant.name}</span>
    <button type="button" aria-label="Next variant" onClick={() => go(1)} style={arrow}>→</button>
  </div>;
}

const arrow: CSSProperties = {
  background: "#333", color: "#fff", border: 0, borderRadius: 999, width: 30, height: 30, cursor: "pointer", fontSize: 15,
};
