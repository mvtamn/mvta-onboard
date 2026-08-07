// Detour image attachments (Part B3 of detour-and-event-module-
// implementation-plan.md) - staff photos of signage, hand-marked maps,
// screenshots. Images never pass through this Function App: the client
// asks here for a short-lived SAS write URL, uploads directly to Blob
// Storage, then tells this API the upload succeeded so a DetourImages row
// can be created. Reads work the same way in reverse - this endpoint hands
// back a fresh short-lived SAS read URL per image, never a permanent or
// public URL. Writes sit at the same tier as editing the detour itself
// (Publisher/Admin plus OCC.Detour - DETOUR_ATTACHMENT_WRITE_ROLES), per the
// owner's original B3 decision. OCC.Compliance is deliberately NOT a writer:
// it previously had attachment writes without detour edit access, which
// contradicted that rule. Reads follow DETOUR_READ_ROLES, which does include
// OCC.Compliance.
import { app, type HttpRequest, type InvocationContext } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { requireRole, DETOUR_READ_ROLES, DETOUR_ATTACHMENT_WRITE_ROLES } from "../lib/auth";
import { validateUploadUrlRequest, validateCreateDetourImage, isGuid } from "../lib/validation";
import { getUploadSasUrl, getReadSasUrl, buildDetourImageBlobPath, BlobStorageNotConfiguredError } from "../lib/blobStorage";

interface DetourImageRow {
  id: string;
  detour_id: string;
  blob_path: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  caption: string | null;
  sort_order: number;
  uploaded_by: string;
  uploaded_at: Date;
}

app.http("detourImagesUploadUrl", {
  route: "detours/{id}/images/upload-url",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, DETOUR_ATTACHMENT_WRITE_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    const detourId = request.params.id;
    if (!isGuid(detourId)) {
      return { status: 400, jsonBody: { error: "id must be a GUID" } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateUploadUrlRequest(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as { file_name: string };

    const blobPath = buildDetourImageBlobPath(detourId, body.file_name);
    try {
      const uploadUrl = await getUploadSasUrl(blobPath);
      return { status: 200, jsonBody: { upload_url: uploadUrl, blob_path: blobPath } };
    } catch (err) {
      if (err instanceof BlobStorageNotConfiguredError) {
        return { status: 503, jsonBody: { error: "Image storage is not configured yet." } };
      }
      context.error("POST /detours/{id}/images/upload-url failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("detourImagesCreate", {
  route: "detours/{id}/images",
  methods: ["POST"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, DETOUR_ATTACHMENT_WRITE_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    const detourId = request.params.id;
    if (!isGuid(detourId)) {
      return { status: 400, jsonBody: { error: "id must be a GUID" } };
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Request body must be valid JSON" } };
    }
    const errors = validateCreateDetourImage(raw as Record<string, unknown>);
    if (errors.length > 0) {
      return { status: 400, jsonBody: { error: "Validation failed", details: errors } };
    }
    const body = raw as {
      blob_path: string;
      file_name: string;
      content_type?: string | null;
      size_bytes?: number | null;
      caption?: string | null;
    };

    try {
      const pool = await getPool();
      const sqlRequest = pool.request();
      sqlRequest.input("detour_id", sql.UniqueIdentifier, detourId);
      sqlRequest.input("blob_path", sql.NVarChar, body.blob_path);
      sqlRequest.input("file_name", sql.NVarChar, body.file_name);
      sqlRequest.input("content_type", sql.NVarChar, body.content_type ?? null);
      sqlRequest.input("size_bytes", sql.Int, body.size_bytes ?? null);
      sqlRequest.input("caption", sql.NVarChar, body.caption ?? null);
      sqlRequest.input("uploaded_by", sql.NVarChar, authResult.principal.userDetails || "system");

      const result = await sqlRequest.query<DetourImageRow>(`
        INSERT INTO DetourImages (detour_id, blob_path, file_name, content_type, size_bytes, caption, uploaded_by)
        OUTPUT INSERTED.id, INSERTED.detour_id, INSERTED.blob_path, INSERTED.file_name,
               INSERTED.content_type, INSERTED.size_bytes, INSERTED.caption, INSERTED.sort_order,
               INSERTED.uploaded_by, INSERTED.uploaded_at
        VALUES (@detour_id, @blob_path, @file_name, @content_type, @size_bytes, @caption, @uploaded_by)
      `);
      return { status: 201, jsonBody: result.recordset[0] };
    } catch (err) {
      context.error("POST /detours/{id}/images failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});

app.http("detourImagesList", {
  route: "detours/{id}/images",
  methods: ["GET"],
  authLevel: "anonymous", // authorization enforced via requireRole below
  handler: async (request: HttpRequest, context: InvocationContext) => {
    const authResult = requireRole(request, DETOUR_READ_ROLES);
    if (!authResult.authorized) {
      return { status: authResult.status, jsonBody: { error: authResult.message } };
    }
    const detourId = request.params.id;
    if (!isGuid(detourId)) {
      return { status: 400, jsonBody: { error: "id must be a GUID" } };
    }

    try {
      const pool = await getPool();
      const tableCheck = await pool.request().query<{ table_exists: number }>(`
        SELECT CASE WHEN OBJECT_ID('dbo.DetourImages', 'U') IS NULL THEN 0 ELSE 1 END AS table_exists
      `);
      if (tableCheck.recordset[0]?.table_exists !== 1) {
        return { status: 200, jsonBody: { images: [] } };
      }

      const req = pool.request();
      req.input("detour_id", sql.UniqueIdentifier, detourId);
      const result = await req.query<DetourImageRow>(`
        SELECT id, detour_id, blob_path, file_name, content_type, size_bytes, caption,
               sort_order, uploaded_by, uploaded_at
        FROM DetourImages
        WHERE detour_id = @detour_id
        ORDER BY sort_order
      `);

      let images;
      try {
        images = await Promise.all(
          result.recordset.map(async (img) => ({
            ...img,
            read_url: await getReadSasUrl(img.blob_path),
          })),
        );
      } catch (err) {
        if (err instanceof BlobStorageNotConfiguredError) {
          // Metadata is real even if storage isn't configured yet - return
          // it without a read URL rather than failing the whole request.
          images = result.recordset.map((img) => ({ ...img, read_url: null }));
        } else {
          throw err;
        }
      }

      return { status: 200, jsonBody: { images } };
    } catch (err) {
      context.error("GET /detours/{id}/images failed:", err);
      return { status: 500, jsonBody: { error: "Internal server error" } };
    }
  },
});
