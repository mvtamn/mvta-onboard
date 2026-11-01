import { ApiError } from "@mvta/shared";

/**
 * What went wrong, in one sentence a person can act on.
 *
 * A 400 from the API says only "Validation failed" in `error`; the fields at
 * fault are in `details` - a list of sentences, or of `{ message }` objects
 * on newer endpoints. Showing the headline alone left people guessing which
 * field to fix, so the details are appended when there are any.
 */
export function apiErrorText(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return err instanceof Error && err.message ? err.message : fallback;
  const details = errorDetails(err.details);
  if (details.length === 0) return err.message || fallback;
  return `${err.message || fallback}: ${details.join("; ")}`;
}

function errorDetails(details: unknown): string[] {
  if (!Array.isArray(details)) return typeof details === "string" && details.trim() ? [details.trim()] : [];
  return details
    .map((detail) => typeof detail === "string" ? detail : detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string" ? (detail as { message: string }).message : "")
    .map((detail) => detail.trim())
    .filter(Boolean);
}
