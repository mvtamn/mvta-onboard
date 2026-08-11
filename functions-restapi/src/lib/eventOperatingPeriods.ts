export interface OperatingPeriodInput {
  start_at: string | null | undefined;
  end_at: string | null | undefined;
}

export type OperatingPeriodValidation =
  | { valid: true; startAt: Date; endAt: Date }
  | { valid: false; error: string };

export function validateOperatingPeriod(input: OperatingPeriodInput): OperatingPeriodValidation {
  if (!input.start_at || !input.end_at) {
    return { valid: false, error: "start_at and end_at are required" };
  }
  const startAt = new Date(input.start_at);
  const endAt = new Date(input.end_at);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return { valid: false, error: "start_at and end_at must be valid timestamps" };
  }
  if (startAt >= endAt) {
    return { valid: false, error: "start_at must be before end_at" };
  }
  return { valid: true, startAt, endAt };
}
