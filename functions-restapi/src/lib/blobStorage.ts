// Thin wrapper around @azure/storage-blob for Detour image attachments
// (see detour-and-event-module-implementation-plan.md, Part B3). No storage
// account key is ever handled - the Function App's own managed identity
// signs short-lived user-delegation SAS tokens, same zero-standing-secret
// identity convention as every other Azure resource in this repo (SQL uses
// a connection string today, but Storage/Service Bus are both identity-
// only). DefaultAzureCredential resolves to the Function App's managed
// identity in Azure, and to the developer's own `az login` session locally.
import { BlobServiceClient, generateBlobSASQueryParameters, BlobSASPermissions } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

export class BlobStorageNotConfiguredError extends Error {
  constructor() {
    super("DETOUR_IMAGES_STORAGE_ACCOUNT is not configured.");
    this.name = "BlobStorageNotConfiguredError";
  }
}

const CONTAINER_NAME = "detour-images";
const SAS_EXPIRY_MINUTES = 15;

let cachedClient: BlobServiceClient | null = null;

function getBlobServiceClient(): BlobServiceClient {
  const accountName = process.env.DETOUR_IMAGES_STORAGE_ACCOUNT;
  if (!accountName) {
    throw new BlobStorageNotConfiguredError();
  }
  if (!cachedClient) {
    cachedClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      new DefaultAzureCredential(),
    );
  }
  return cachedClient;
}

// Builds the blob path a new image lives at - never exposed as a public
// URL, only ever resolved through the SAS helpers below.
export function buildDetourImageBlobPath(detourId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `detours/${detourId}/${crypto.randomUUID()}-${safeName}`;
}

async function getUserDelegationKey(client: BlobServiceClient) {
  const now = new Date();
  const expiresOn = new Date(now.getTime() + SAS_EXPIRY_MINUTES * 60 * 1000);
  return client.getUserDelegationKey(now, expiresOn);
}

// Write-only SAS - staff upload directly to Blob Storage with this,
// nothing ever passes through the Function App itself.
export async function getUploadSasUrl(blobPath: string): Promise<string> {
  const client = getBlobServiceClient();
  const delegationKey = await getUserDelegationKey(client);
  const now = new Date();
  const expiresOn = new Date(now.getTime() + SAS_EXPIRY_MINUTES * 60 * 1000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER_NAME,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse("cw"), // create + write
      startsOn: now,
      expiresOn,
    },
    delegationKey,
    client.accountName,
  ).toString();

  return `${client.url}${CONTAINER_NAME}/${blobPath}?${sas}`;
}

// Read-only SAS - minted fresh on every GET /detours/{id}/images call so a
// leaked link goes stale quickly; never a permanent/public URL.
export async function getReadSasUrl(blobPath: string): Promise<string> {
  const client = getBlobServiceClient();
  const delegationKey = await getUserDelegationKey(client);
  const now = new Date();
  const expiresOn = new Date(now.getTime() + SAS_EXPIRY_MINUTES * 60 * 1000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER_NAME,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse("r"),
      startsOn: now,
      expiresOn,
    },
    delegationKey,
    client.accountName,
  ).toString();

  return `${client.url}${CONTAINER_NAME}/${blobPath}?${sas}`;
}

export async function deleteBlob(blobPath: string): Promise<void> {
  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(CONTAINER_NAME);
  await containerClient.deleteBlob(blobPath, { deleteSnapshots: "include" });
}
