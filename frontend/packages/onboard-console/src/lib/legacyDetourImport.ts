// Parsing for the Legacy spreadsheet history import on Detour Reports.
//
// The tracker this replaces was an Excel sheet, so the file that arrives
// here is whatever Excel saved: a UTF-8 BOM, CRLF line endings, and closure
// text that routinely contains commas and the odd embedded quote or line
// break. A split-on-comma parser turned every one of those into a shifted
// row, and it also assumed the columns arrived in one fixed order. This
// parser handles quoting per RFC 4180 and maps columns by header name, so
// the sheet can carry its columns in any order and under the names staff
// actually used - including a re-import of this page's own CSV export.

export interface LegacyImportRow {
  reference?: string | null;
  closure: string;
  service_date?: string | null;
  routes?: string | null;
  communication_audience?: string | null;
  communication_channel?: string | null;
  communication_recipients?: string | null;
  communication_content?: string | null;
  communicated_at?: string | null;
  [extra: string]: unknown;
}

export interface LegacyImportParse {
  rows: LegacyImportRow[];
  // Source rows dropped because they had no closure text, 1-based and
  // excluding the header, so a reader can find them in the sheet.
  skipped_rows: number[];
  unmapped_columns: string[];
}

// Parses CSV text into rows of cells. Quoted cells may contain commas,
// doubled quotes ("") and line breaks; unquoted cells end at the next
// comma or line break. A trailing newline does not produce an empty row.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(cell); cell = ""; continue; }
    if (ch === "\r") { continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Header aliases, normalized to lowercase alphanumerics. Covers the
// tracker's own headings, the JSON field names, and the Detour Reports CSV
// export so an export can be re-imported.
const COLUMN_ALIASES: Record<keyof Omit<LegacyImportRow, "closure"> | "closure", string[]> = {
  reference: ["reference", "historicalreference", "ref", "number", "internalref", "detournumber", "id"],
  closure: ["closure", "closurelocationdescription", "description", "location", "detour"],
  service_date: ["servicedate", "date", "startdate", "effectivedate", "dates"],
  routes: ["routes", "route", "routesaffected", "affectedroutes"],
  communication_audience: ["communicationaudience", "audience", "notified", "sentto"],
  communication_channel: ["communicationchannel", "channel", "method"],
  communication_recipients: ["communicationrecipients", "recipients", "distribution", "distributionlist"],
  communication_content: ["communicationcontent", "content", "message", "notes", "communication"],
  communicated_at: ["communicatedat", "sentat", "senton", "datesent", "notifiedat"],
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mapHeaders(headers: string[]): { fields: (keyof LegacyImportRow | null)[]; unmapped: string[] } {
  const taken = new Set<string>();
  const unmapped: string[] = [];
  const fields = headers.map((header) => {
    const key = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (!taken.has(field) && aliases.includes(key)) { taken.add(field); return field as keyof LegacyImportRow; }
    }
    if (header.trim()) unmapped.push(header.trim());
    return null;
  });
  return { fields, unmapped };
}

function cleanRow(input: Record<string, unknown>): LegacyImportRow | null {
  const closure = typeof input.closure === "string" ? input.closure.trim() : "";
  if (!closure) return null;
  const row: LegacyImportRow = { ...input, closure };
  for (const key of Object.keys(COLUMN_ALIASES) as (keyof LegacyImportRow)[]) {
    if (key === "closure") continue;
    const value = row[key];
    row[key] = typeof value === "string" ? (value.trim() || null) : value ?? null;
  }
  return row;
}

export function parseLegacyCsv(text: string): LegacyImportParse {
  const records = parseCsv(text);
  if (records.length === 0) return { rows: [], skipped_rows: [], unmapped_columns: [] };
  const [headers, ...body] = records;
  const { fields, unmapped } = mapHeaders(headers);
  if (!fields.includes("closure")) {
    throw new Error(`No closure column found. Headers seen: ${headers.filter(Boolean).join(", ") || "(none)"}`);
  }
  const rows: LegacyImportRow[] = [];
  const skipped: number[] = [];
  body.forEach((cells, index) => {
    const record: Record<string, unknown> = {};
    fields.forEach((field, i) => {
      const value = cells[i] ?? "";
      if (field) record[field] = value;
      else if (headers[i]?.trim()) record[headers[i].trim()] = value;
    });
    const row = cleanRow(record);
    if (row) rows.push(row); else skipped.push(index + 1);
  });
  return { rows, skipped_rows: skipped, unmapped_columns: unmapped };
}

export function parseLegacyJson(text: string): LegacyImportParse {
  const parsed: unknown = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { rows?: unknown }).rows) ? (parsed as { rows: unknown[] }).rows : null;
  if (!list) throw new Error("JSON must be an array of rows or an object with a rows array");
  const rows: LegacyImportRow[] = [];
  const skipped: number[] = [];
  list.forEach((item, index) => {
    const row = item && typeof item === "object" ? cleanRow(item as Record<string, unknown>) : null;
    if (row) rows.push(row); else skipped.push(index + 1);
  });
  return { rows, skipped_rows: skipped, unmapped_columns: [] };
}

export function parseLegacyImportFile(fileName: string, text: string): LegacyImportParse {
  return fileName.toLowerCase().endsWith(".json") ? parseLegacyJson(text) : parseLegacyCsv(text);
}
