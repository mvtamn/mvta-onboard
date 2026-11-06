// The Count Sheet scan storage account (storage-count-sheet-scans.bicep,
// plans/count-sheet-scan-upload.md §5). Same identity-only posture as the
// detour images in lib/blobStorage.ts: the REST app's managed identity signs
// short-lived user-delegation SAS tokens, and no account key exists.
//
//   count-sheet-originals - the file exactly as the desk uploaded it, under
//                           version-level immutability (WORM). The browser
//                           writes it once through a create-only SAS.
//   count-sheet-pages     - straightened page images, derived from the
//                           originals and rebuildable, so not WORM.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BlobSASPermissions, BlobServiceClient, generateBlobSASQueryParameters } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { sasWindow } from "../../blobStorage";

export const ORIGINALS_CONTAINER = "count-sheet-originals";
export const PAGES_CONTAINER = "count-sheet-pages";
/** Opening a page image: long enough to load it, short enough that a copied link is soon dead. */
export const IMAGE_LINK_MINUTES = 5;

export class ScanStorageNotConfiguredError extends Error {
  constructor() {
    super("RIDERSHIP_SCANS_STORAGE_ACCOUNT is not configured.");
    this.name = "ScanStorageNotConfiguredError";
  }
}

export function scanStorageConfigured(): boolean {
  return Boolean(process.env.RIDERSHIP_SCANS_STORAGE_ACCOUNT);
}

let cached: BlobServiceClient | null = null;
function client(): BlobServiceClient {
  const account = process.env.RIDERSHIP_SCANS_STORAGE_ACCOUNT;
  if (!account) throw new ScanStorageNotConfiguredError();
  cached ??= new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential());
  return cached;
}

/** Where an upload's original lives: by month, then the upload id. Never shown to anyone. */
export function originalBlobPath(uploadId: string, now: Date): string {
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${uploadId}.pdf`;
}

export function pageBlobPath(uploadId: string, pageIndex: number): string {
  return `${uploadId}/${String(pageIndex + 1).padStart(3, "0")}.jpg`;
}

async function sas(container: string, blobPath: string, permissions: string, minutes?: number): Promise<{ url: string; expiresOn: Date }> {
  const c = client();
  const now = new Date();
  const window = sasWindow(now);
  const expiresOn = minutes ? new Date(now.getTime() + minutes * 60_000) : window.expiresOn;
  const key = await c.getUserDelegationKey(window.keyStartsOn, window.keyExpiresOn);
  const query = generateBlobSASQueryParameters(
    { containerName: container, blobName: blobPath, permissions: BlobSASPermissions.parse(permissions), startsOn: window.startsOn, expiresOn },
    key,
    c.accountName,
  ).toString();
  return { url: `${c.url}${container}/${blobPath}?${query}`, expiresOn };
}

/** Create-only: the browser can write the original once and cannot read, list or overwrite anything. */
export async function originalUploadUrl(blobPath: string): Promise<string> {
  return (await sas(ORIGINALS_CONTAINER, blobPath, "c")).url;
}

/** A page image for one viewer, for IMAGE_LINK_MINUTES. */
export function pageImageUrl(blobPath: string): Promise<{ url: string; expiresOn: Date }> {
  return sas(PAGES_CONTAINER, blobPath, "r", IMAGE_LINK_MINUTES);
}

async function download(container: string, blobPath: string): Promise<Buffer> {
  const response = await client().getContainerClient(container).getBlobClient(blobPath).download();
  const chunks: Buffer[] = [];
  for await (const chunk of response.readableStreamBody ?? []) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** The original's size, or null when nothing was uploaded there. */
export async function originalSize(blobPath: string): Promise<number | null> {
  const blob = client().getContainerClient(ORIGINALS_CONTAINER).getBlobClient(blobPath);
  if (!(await blob.exists())) return null;
  return (await blob.getProperties()).contentLength ?? null;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Every page of an upload is its own queue message, and each needs the whole
// PDF. The REST app is one B1 worker, so the original is kept on local disk
// for the hour it takes to work through a batch rather than downloaded once
// per page. The hash is checked on every read, so a stale or partial file is
// never used.
const CACHE_DIR = path.join(tmpdir(), "count-sheet-originals");
const CACHE_HOURS = 6;

export async function readOriginal(blobPath: string, sha256: string): Promise<Buffer> {
  const file = path.join(CACHE_DIR, `${sha256}.pdf`);
  try {
    const cachedBytes = await readFile(file);
    if (sha256Hex(cachedBytes) === sha256) return cachedBytes;
  } catch {
    // not cached
  }
  const bytes = await download(ORIGINALS_CONTAINER, blobPath);
  if (sha256Hex(bytes) !== sha256) throw new Error(`The stored original ${blobPath} does not match its recorded SHA-256.`);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, bytes);
  await pruneCache();
  return bytes;
}

async function pruneCache(): Promise<void> {
  const cutoff = Date.now() - CACHE_HOURS * 3_600_000;
  for (const name of await readdir(CACHE_DIR).catch(() => [] as string[])) {
    const full = path.join(CACHE_DIR, name);
    const info = await stat(full).catch(() => null);
    if (info && info.mtimeMs < cutoff) await rm(full, { force: true });
  }
}

/** Writes (or rewrites, on a retry) a page's straightened image. */
export async function writePageImage(blobPath: string, jpeg: Buffer): Promise<void> {
  const container = client().getContainerClient(PAGES_CONTAINER);
  await container.getBlockBlobClient(blobPath).upload(jpeg, jpeg.length, { blobHTTPHeaders: { blobContentType: "image/jpeg" } });
}
