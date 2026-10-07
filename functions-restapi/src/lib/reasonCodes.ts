// Admin-editable reason codes: a short code, the label staff actually read,
// and whether it is still offered.
//
// Two tables hold them and they were two handlers, 362 lines, answering the
// same three questions - list them, add one, edit one - in near-identical
// code. The PATCH bodies were line-for-line the same apart from the table
// name, and the validators were two copies of one set of rules declared 500
// lines apart in validation.ts, with two separate constants both meaning 30.
//
// What genuinely differs between them is small enough to be data:
//
//   OtpReasonCodes has `applies_to` ('stop' | 'date' | 'missed_trip'), part of
//   its unique key and required on create. It is read by OTP's two exclusion
//   kinds AND, since migration 023, by Missed Trips' investigation outcomes -
//   which is why the table's name is a holdover. Renaming it is worth doing
//   and is deliberately not done here.
//
//   DetourReasonCodes serves one consumer and has no such column.
//
// Reading them is gated differently per scope - the same people who can see a
// detour may resolve its code, and compliance readers may resolve theirs -
// but that is the handler's business, not this module's.
import { sql } from "./db";
import type { Executor } from "./otpMonth";

export type ReasonCodeScope = "otp" | "detour";

/** The sub-kind an OTP reason code applies to. Detour codes have none. */
export type ReasonCodeAppliesTo = "stop" | "date" | "missed_trip";

export const REASON_CODE_APPLIES_TO: readonly ReasonCodeAppliesTo[] = ["stop", "date", "missed_trip"];

export const MAX_REASON_CODE_LENGTH = 30;
export const MAX_REASON_LABEL_LENGTH = 100;

export interface ReasonCode {
  id: string;
  code: string;
  label: string;
  /** Present only for the OTP scope. */
  applies_to?: ReasonCodeAppliesTo;
  is_active: boolean;
  sort_order: number;
  updated_by: string | null;
  updated_at: Date;
}

export interface CreateReasonCode {
  code: string;
  label: string;
  /** Required for the OTP scope, meaningless for the detour one. */
  applies_to?: ReasonCodeAppliesTo;
  sort_order?: number;
}

export interface UpdateReasonCode {
  label?: string;
  is_active?: boolean;
  sort_order?: number;
}

interface ScopeDescriptor {
  table: string;
  /** Null where the table has no sub-kind. */
  appliesToColumn: string | null;
  columns: string;
  order: string;
  /** The unique constraint a duplicate code violates. */
  duplicateConstraint: string;
}

const SCOPES: Record<ReasonCodeScope, ScopeDescriptor> = {
  otp: {
    table: "OtpReasonCodes",
    appliesToColumn: "applies_to",
    columns: "id, code, label, applies_to, is_active, sort_order, updated_by, updated_at",
    order: "applies_to, sort_order",
    duplicateConstraint: "UX_OtpReasonCodes_Code_AppliesTo",
  },
  detour: {
    table: "DetourReasonCodes",
    appliesToColumn: null,
    columns: "id, code, label, is_active, sort_order, updated_by, updated_at",
    order: "sort_order, label",
    duplicateConstraint: "UX_DetourReasonCodes_Code",
  },
};

const request = (executor: Executor) =>
  executor instanceof sql.Transaction ? new sql.Request(executor) : executor.request();

const outputOf = (scope: ScopeDescriptor): string =>
  scope.columns.split(", ").map((c) => `INSERTED.${c}`).join(", ");

/**
 * Raised instead of letting a unique-constraint violation reach the caller as
 * a server fault. Adding a code that already exists is a user error.
 */
export class DuplicateReasonCode extends Error {
  constructor() {
    super("That reason code already exists");
    this.name = "DuplicateReasonCode";
  }
}

/** Whether the scope's table exists yet. */
export async function reasonCodesReady(executor: Executor, scope: ReasonCodeScope): Promise<boolean> {
  const { table } = SCOPES[scope];
  const probe = await request(executor).query<{ has_table: number }>(`
    SELECT CASE WHEN OBJECT_ID('dbo.${table}', 'U') IS NULL THEN 0 ELSE 1 END AS has_table
  `);
  return probe.recordset[0]?.has_table === 1;
}

/**
 * The scope's reason codes. An absent table yields an empty list rather than
 * an error: a console whose migration has not run should show no dropdown, not
 * an error banner on a page that otherwise works.
 */
export async function listReasonCodes(
  executor: Executor,
  scope: ReasonCodeScope,
  filter: { appliesTo?: string | null; activeOnly?: boolean } = {},
): Promise<ReasonCode[]> {
  const descriptor = SCOPES[scope];
  if (!(await reasonCodesReady(executor, scope))) return [];

  const req = request(executor);
  const conditions: string[] = [];
  const appliesTo = filter.appliesTo;
  if (descriptor.appliesToColumn && isAppliesTo(appliesTo)) {
    req.input("applies_to", sql.NVarChar(20), appliesTo);
    conditions.push(`${descriptor.appliesToColumn} = @applies_to`);
  }
  if (filter.activeOnly) conditions.push("is_active = 1");

  const result = await req.query<ReasonCode>(`
    SELECT ${descriptor.columns}
    FROM ${descriptor.table}
    ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY ${descriptor.order}
  `);
  return result.recordset;
}

export function isAppliesTo(value: unknown): value is ReasonCodeAppliesTo {
  return typeof value === "string" && (REASON_CODE_APPLIES_TO as readonly string[]).includes(value);
}

/** Add a code. Throws DuplicateReasonCode where the scope already has one. */
export async function createReasonCode(
  executor: Executor,
  scope: ReasonCodeScope,
  input: CreateReasonCode,
  actor: string,
): Promise<ReasonCode> {
  const descriptor = SCOPES[scope];
  const req = request(executor);
  // Bound to the columns' real widths rather than left open: if validation is
  // ever loosened, an over-long value should be refused, not truncated.
  req.input("code", sql.NVarChar(MAX_REASON_CODE_LENGTH), input.code);
  req.input("label", sql.NVarChar(MAX_REASON_LABEL_LENGTH), input.label);
  req.input("sort_order", sql.Int, input.sort_order ?? 0);
  req.input("updated_by", sql.NVarChar(200), actor);

  const columns = ["code", "label", "sort_order", "updated_by"];
  const values = ["@code", "@label", "@sort_order", "@updated_by"];
  if (descriptor.appliesToColumn) {
    req.input("applies_to", sql.NVarChar(20), input.applies_to);
    columns.splice(2, 0, descriptor.appliesToColumn);
    values.splice(2, 0, "@applies_to");
  }

  try {
    const result = await req.query<ReasonCode>(`
      INSERT INTO ${descriptor.table} (${columns.join(", ")})
      OUTPUT ${outputOf(descriptor)}
      VALUES (${values.join(", ")})
    `);
    return result.recordset[0]!;
  } catch (err) {
    if (err instanceof Error && new RegExp(descriptor.duplicateConstraint).test(err.message)) {
      throw new DuplicateReasonCode();
    }
    throw err;
  }
}

/**
 * Edit a code's presentation and lifecycle. `code` and `applies_to` are
 * deliberately immutable: a reason code is referenced by its string, without a
 * foreign key, so renaming one would silently orphan every record citing it.
 * Retire it with is_active = false and add a new one instead.
 *
 * Returns undefined where no row has that id.
 */
export async function updateReasonCode(
  executor: Executor,
  scope: ReasonCodeScope,
  id: string,
  patch: UpdateReasonCode,
  actor: string,
): Promise<ReasonCode | undefined> {
  const descriptor = SCOPES[scope];
  const req = request(executor);
  req.input("id", sql.UniqueIdentifier, id);
  req.input("updated_by", sql.NVarChar(200), actor);

  const sets = ["updated_by = @updated_by", "updated_at = SYSUTCDATETIME()"];
  if (patch.label !== undefined) {
    sets.push("label = @label");
    req.input("label", sql.NVarChar(MAX_REASON_LABEL_LENGTH), patch.label);
  }
  if (patch.is_active !== undefined) {
    sets.push("is_active = @is_active");
    req.input("is_active", sql.Bit, patch.is_active);
  }
  if (patch.sort_order !== undefined) {
    sets.push("sort_order = @sort_order");
    req.input("sort_order", sql.Int, patch.sort_order);
  }

  const result = await req.query<ReasonCode>(`
    UPDATE ${descriptor.table}
    SET ${sets.join(", ")}
    OUTPUT ${outputOf(descriptor)}
    WHERE id = @id
  `);
  return result.recordset[0];
}
