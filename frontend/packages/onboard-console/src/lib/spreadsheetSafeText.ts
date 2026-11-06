// A cell that starts with = + - @ (or a tab/CR) is run as a formula when
// Excel or Sheets opens a CSV, so text typed into OnBoard - a detour closure,
// a display name - could become a live HYPERLINK or DDE call in the reader's
// spreadsheet. A leading apostrophe makes the spreadsheet show the text as
// typed. Every CSV the console writes passes its cells through this.
export function spreadsheetSafeText(value: unknown): string {
  const text = String(value ?? "");
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
