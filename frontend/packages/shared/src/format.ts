// Small formatting helpers shared by the rider and console apps.

/** "just now" / "5 min ago" / "3 hr ago" / a date once older than a day. */
export function timeAgo(isoString: string | null | undefined): string | null {
  if (!isoString) return null;
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(isoString).toLocaleDateString();
}

/** "Jul 6, 11:59 PM" style short local timestamp. */
export function formatExpires(isoString: string | null | undefined): string {
  if (!isoString) return "";
  return new Date(isoString).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
