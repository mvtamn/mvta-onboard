import { useEffect, useState } from "react";

// A clock the Watch queue and the Timeline's "now" marker share. Ticks on the
// given interval; a paused clock (intervalMs null) is for a day that is not
// today, where "now" has no meaning on the page.
export function useNow(intervalMs: number | null): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (intervalMs === null) return;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
