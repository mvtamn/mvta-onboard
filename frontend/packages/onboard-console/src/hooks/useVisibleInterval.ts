import { useEffect, useRef } from "react";

// Calls `callback` every `intervalMs` while the page is visible, and once as
// soon as a hidden page becomes visible again. A console left open in a
// background tab should not keep polling the REST app - it runs every poller
// and every endpoint on one small plan, and bursts there have starved feeds
// before - but a dispatcher who switches back to it should see current data at
// once rather than waiting out the rest of an interval.
export function useVisibleInterval(callback: () => void, intervalMs: number): void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  }, [callback]);

  useEffect(() => {
    const visible = () => document.visibilityState !== "hidden";
    const timer = window.setInterval(() => {
      if (visible()) latest.current();
    }, intervalMs);
    const onVisibilityChange = () => {
      if (visible()) latest.current();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs]);
}
