// A service month as the OTP module passes it around: "YYYYMM", the shape the
// API and the database use throughout. The converters live here rather than in
// one page, because the picker, the Review Queue's "copy last month" and the
// Audit Stream's month scope all need the same ones.
export function currentServiceMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// <input type="month"> uses "YYYY-MM"; the API and the database use "YYYYMM".
export function toMonthInputValue(yyyymm: string): string {
  return `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}`;
}
export function fromMonthInputValue(value: string): string {
  return value.replace("-", "");
}

// "YYYYMM" -> the prior month's. Used by the Review Queue's "copy last
// month's decisions", which deliberately still writes a fresh, dated row for
// the current month via the normal PUT rather than carrying one forward, so
// every month keeps its own real reviewed_by/reviewed_at.
export function previousServiceMonth(yyyymm: string): string {
  const year = parseInt(yyyymm.slice(0, 4), 10);
  const month = parseInt(yyyymm.slice(4, 6), 10); // 1-indexed
  const d = new Date(Date.UTC(year, month - 1 - 1, 1)); // -1 for prior month, -1 for 0-indexed Date
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Display-only - "YYYYMM" -> "MM/YYYY" (e.g. "202608" -> "08/2026"), for
// anywhere a resolved service month is shown as text rather than in the
// <input type="month"> picker itself.
export function formatServiceMonth(yyyymm: string): string {
  return `${yyyymm.slice(4, 6)}/${yyyymm.slice(0, 4)}`;
}
