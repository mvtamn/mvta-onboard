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

// Azure rejects (403) any SAS whose expiry runs past the user-delegation
// key's own expiry, so the key must outlive the token it signs - not match
// it. Getting the key is a network round-trip, so a key requested for
// exactly SAS_EXPIRY_MINUTES would already be expiring slightly BEFORE a
// token minted after that call returns.
const DELEGATION_KEY_EXTRA_MINUTES = 15;

// Both the key and the SAS start slightly in the past: Azure validates
// startsOn against ITS clock, and a token stamped "valid from now" fails as
// not-yet-valid under even a few seconds of clock skew.
const CLOCK_SKEW_MINUTES = 5;

function minutesFrom(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60 * 1000);
}

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

export function buildDetourIntakeImageBlobPath(intakeId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `detour-intake/${intakeId}/${crypto.randomUUID()}-${safeName}`;
}

// Exported for unit testing the expiry math without a live storage account:
// the key window must fully contain the SAS window, or Azure 403s.
export function sasWindow(now: Date) {
  const startsOn = minutesFrom(now, -CLOCK_SKEW_MINUTES);
  return {
    startsOn,
    // SAS expiry is measured from `now`, not from the back-dated start, so
    // back-dating never eats into the usable 15 minutes.
    expiresOn: minutesFrom(now, SAS_EXPIRY_MINUTES),
    keyStartsOn: startsOn,
    keyExpiresOn: minutesFrom(now, SAS_EXPIRY_MINUTES + DELEGATION_KEY_EXTRA_MINUTES),
  };
}

async function buildSasUrl(blobPath: string, permissions: string): Promise<string> {
  const client = getBlobServiceClient();
  const { startsOn, expiresOn, keyStartsOn, keyExpiresOn } = sasWindow(new Date());
  const delegationKey = await client.getUserDelegationKey(keyStartsOn, keyExpiresOn);

  const sas = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER_NAME,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse(permissions),
      startsOn,
      expiresOn,
    },
    delegationKey,
    client.accountName,
  ).toString();

  return `${client.url}${CONTAINER_NAME}/${blobPath}?${sas}`;
}

// Write-only SAS - staff upload directly to Blob Storage with this,
// nothing ever passes through the Function App itself.
export function getUploadSasUrl(blobPath: string): Promise<string> {
  return buildSasUrl(blobPath, "cw"); // create + write
}

// Read-only SAS - minted fresh on every GET /detours/{id}/images call so a
// leaked link goes stale quickly; never a permanent/public URL.
export function getReadSasUrl(blobPath: string): Promise<string> {
  return buildSasUrl(blobPath, "r");
}

export async function deleteBlob(blobPath: string): Promise<void> {
  const client = getBlobServiceClient();
  const containerClient = client.getContainerClient(CONTAINER_NAME);
  await containerClient.deleteBlob(blobPath, { deleteSnapshots: "include" });
}

let cachedReportClient: BlobServiceClient | null = null;
function getReportBlobServiceClient(): BlobServiceClient {
  const accountName=process.env.COMPLIANCE_REPORTS_STORAGE_ACCOUNT;
  if(!accountName) throw new Error("COMPLIANCE_REPORTS_STORAGE_ACCOUNT is not configured.");
  cachedReportClient ??= new BlobServiceClient(`https://${accountName}.blob.core.windows.net`,new DefaultAzureCredential());
  return cachedReportClient;
}
export function buildComplianceReportBlobPath(periodId:string,reportId:string):string{return `periods/${periodId}/${reportId}.html`;}
export async function uploadComplianceReport(blobPath:string,html:string):Promise<void>{const container=getReportBlobServiceClient().getContainerClient("compliance-reports");await container.createIfNotExists();await container.getBlockBlobClient(blobPath).upload(html,Buffer.byteLength(html),{blobHTTPHeaders:{blobContentType:"text/html; charset=utf-8"},conditions:{ifNoneMatch:"*"}});}
export async function downloadComplianceReport(blobPath:string):Promise<Buffer>{const response=await getReportBlobServiceClient().getContainerClient("compliance-reports").getBlobClient(blobPath).download();const chunks:Buffer[]=[];for await(const chunk of response.readableStreamBody??[]){chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));}return Buffer.concat(chunks);}
export function buildComplianceEvidenceBlobPath(assessmentId:string,fileName:string):string{return `evidence/${assessmentId}/${crypto.randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g,"_")}`;}
export async function getComplianceEvidenceUploadSasUrl(blobPath:string):Promise<string>{const client=getReportBlobServiceClient();const now=new Date();const startsOn=minutesFrom(now,-CLOCK_SKEW_MINUTES),expiresOn=minutesFrom(now,SAS_EXPIRY_MINUTES);const key=await client.getUserDelegationKey(startsOn,minutesFrom(now,SAS_EXPIRY_MINUTES+DELEGATION_KEY_EXTRA_MINUTES));const containerName="compliance-evidence";await client.getContainerClient(containerName).createIfNotExists();const sas=generateBlobSASQueryParameters({containerName,blobName:blobPath,permissions:BlobSASPermissions.parse("cw"),startsOn,expiresOn},key,client.accountName).toString();return `${client.url}${containerName}/${blobPath}?${sas}`;}
export async function downloadComplianceEvidence(blobPath:string):Promise<Buffer>{const response=await getReportBlobServiceClient().getContainerClient("compliance-evidence").getBlobClient(blobPath).download();const chunks:Buffer[]=[];for await(const chunk of response.readableStreamBody??[]){chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));}return Buffer.concat(chunks);}
