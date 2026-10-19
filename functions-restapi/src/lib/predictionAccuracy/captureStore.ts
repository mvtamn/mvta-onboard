// Where the prediction capture writes: one append blob per Central calendar
// date in the `prediction-capture` container of PREDICTION_CAPTURE_STORAGE_ACCOUNT
// (infra-phase1/modules/storage-prediction-capture.bicep), which deletes a
// day's file after 90 days.
//
// Blob, not SQL: about 3,000 small writes a day of raw lines is cheap here and
// would be load on the 1-vCore database that has saturated before. Only the
// nightly scorer's aggregates go to SQL (increment 2).
//
// Each run appends its lines as its own gzip member. Concatenated gzip
// members are one valid gzip file, so the scorer gunzips the whole blob in one
// call, and a run that fails part-way leaves the members before it intact.
//
// Access is the Function App's managed identity (Storage Blob Data
// Contributor on the account), never a key - same as the other two accounts.
import { gzipSync } from "node:zlib";
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

export const PREDICTION_CAPTURE_CONTAINER = "prediction-capture";
export const PREDICTION_CAPTURE_ACCOUNT_SETTING = "PREDICTION_CAPTURE_STORAGE_ACCOUNT";

export function predictionCaptureAccount(env: NodeJS.ProcessEnv = process.env): string | null {
  const name = env[PREDICTION_CAPTURE_ACCOUNT_SETTING]?.trim();
  return name && name !== "REPLACE_ME" ? name : null;
}

let container: { account: string; client: ContainerClient; ready: boolean } | null = null;
// Blobs this process has already created, so a run costs one request, not two.
const createdBlobs = new Set<string>();

async function containerFor(account: string): Promise<ContainerClient> {
  if (!container || container.account !== account) {
    const service = new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential());
    container = { account, client: service.getContainerClient(PREDICTION_CAPTURE_CONTAINER), ready: false };
  }
  if (!container.ready) {
    await container.client.createIfNotExists();
    container.ready = true;
  }
  return container.client;
}

/** One gzip member for one run's lines. Exported for the test. */
export function captureMember(lines: readonly string[]): Buffer {
  return gzipSync(Buffer.from(lines.join("\n") + "\n", "utf-8"));
}

/** Append one run's lines to the day's blob; returns the bytes written. */
export async function appendCapture(account: string, blobName: string, lines: readonly string[]): Promise<number> {
  const client = (await containerFor(account)).getAppendBlobClient(blobName);
  if (!createdBlobs.has(blobName)) {
    await client.createIfNotExists({ blobHTTPHeaders: { blobContentType: "text/csv", blobContentEncoding: "gzip" } });
    createdBlobs.add(blobName);
  }
  const member = captureMember(lines);
  await client.appendBlock(member, member.length);
  return member.length;
}

/** How long the capture waits after a refused write before trying again. */
export const NOT_AUTHORIZED_RETRY_MS = 15 * 60_000;

/**
 * The ledger reason for a write the account refused (HTTP 403), or null for
 * any other error. A 403 here is a missing role assignment, not a passing
 * fault: on 2026-10-16 every run for three hours threw "This request is not
 * authorized to perform this operation" until the role was granted, which
 * made an App Insights exception every 30 seconds.
 */
export function notAuthorizedReason(error: unknown, account: string): string | null {
  const status = typeof error === "object" && error !== null ? (error as { statusCode?: unknown }).statusCode : undefined;
  if (status !== 403) return null;
  const minutes = NOT_AUTHORIZED_RETRY_MS / 60_000;
  return `${account} refused the write (403): the Function App's identity needs Storage Blob Data Contributor on it. Trying again in ${minutes} minutes.`;
}

/**
 * Holds the capture off after a refused write. One per process; the clock is
 * passed in so the test can drive it.
 */
export function createWriteGate(retryMs: number = NOT_AUTHORIZED_RETRY_MS) {
  let closedUntil = 0;
  return {
    isOpen: (now: number) => now >= closedUntil,
    close: (now: number) => { closedUntil = now + retryMs; },
  };
}
