import { useEffect, useState } from "react";
import { ApiError, type DetourImage } from "@mvta/shared";
import { api } from "../config.js";
import { resizeImageFile } from "../lib/imageResize.js";

// Attachments on an authoritative Detour. The store is DetourImages, but
// what lands in it is not only images: Detour Intake accepts PDFs and
// Office documents as evidence and acceptance re-parents them onto the
// Detour, so a PDF rendered through <img> showed as a broken tile. Images
// get a thumbnail; everything else gets a document tile that opens the
// file. Same accept list as the intake form so a document can also be
// added after acceptance.
//
// Uploads go straight to Blob Storage via a short-lived SAS URL - nothing
// passes through the API body. Images are resized client-side first
// (imageResize.ts passes non-images through untouched). Same write tier
// as editing the detour.

export const DETOUR_ATTACHMENT_ACCEPT = "image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,text/plain";

export function isImageAttachment(file: Pick<DetourImage, "content_type" | "file_name">): boolean {
  if (file.content_type) return file.content_type.startsWith("image/");
  return /\.(png|jpe?g|gif|webp|bmp|heic|svg)$/i.test(file.file_name);
}

function extensionLabel(fileName: string, contentType: string | null): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(fileName)?.[1];
  if (ext) return ext.toUpperCase();
  if (contentType === "application/pdf") return "PDF";
  return "FILE";
}

function sizeLabel(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TILE = { width: 90, height: 90, borderRadius: 6, border: "1px solid var(--border)" } as const;

function AttachmentTile({ file }: { file: DetourImage }) {
  const label = file.caption ?? file.file_name;
  const open = () => { if (file.read_url) window.open(file.read_url, "_blank", "noopener,noreferrer"); };
  return (
    <div style={{ textAlign: "center" }}>
      {!file.read_url ? (
        <div className="td-dim" style={{ ...TILE, display: "flex", alignItems: "center", justifyContent: "center" }}>Not ready</div>
      ) : isImageAttachment(file) ? (
        <img src={file.read_url} alt={label} title={label} style={{ ...TILE, objectFit: "cover", cursor: "pointer" }} onClick={open} />
      ) : (
        <a href={file.read_url} target="_blank" rel="noreferrer" title={label} style={{ ...TILE, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, textDecoration: "none", color: "inherit", background: "var(--surface-alt-bg)" }}>
          <strong style={{ fontSize: 14 }}>{extensionLabel(file.file_name, file.content_type)}</strong>
          <span className="td-dim" style={{ fontSize: 11 }}>{sizeLabel(file.size_bytes) || "Open"}</span>
        </a>
      )}
      <div className="td-dim" style={{ fontSize: 11, marginTop: 3, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
}

export function DetourAttachmentsSection({ detourId, canWrite }: { detourId: string; canWrite: boolean }) {
  const [files, setFiles] = useState<DetourImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  function load() {
    api.getDetourImages(detourId)
      .then((d) => setFiles(d.images))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load attachments."));
  }
  useEffect(load, [detourId]);

  async function handleFiles(fileList: FileList) {
    setUploading(true);
    setError(null);
    try {
      for (const rawFile of Array.from(fileList)) {
        const file = await resizeImageFile(rawFile);
        const contentType = file.type || "application/octet-stream";
        const { upload_url, blob_path } = await api.getDetourImageUploadUrl(detourId, file.name, contentType);
        const putRes = await fetch(upload_url, { method: "PUT", headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": contentType }, body: file });
        if (!putRes.ok) throw new Error(`Upload to storage failed (${putRes.status})`);
        await api.createDetourImage(detourId, { blob_path, file_name: file.name, content_type: contentType, size_bytes: file.size });
      }
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <p className="field-label">Attachments</p>
      {error ? <p className="error-text">{error}</p> : null}
      {files === null && !error ? <p className="muted">Loading attachments…</p> : null}
      {files && files.length === 0 ? <p className="td-dim">No attachments.</p> : null}
      {files && files.length > 0 ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          {files.map((file) => <AttachmentTile key={file.id} file={file} />)}
        </div>
      ) : null}
      {canWrite ? (
        <label className="btn-sm" style={{ display: "inline-block", cursor: uploading ? "default" : "pointer" }}>
          {uploading ? "Uploading…" : "+ Attach files"}
          <input type="file" accept={DETOUR_ATTACHMENT_ACCEPT} multiple disabled={uploading} style={{ display: "none" }} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
        </label>
      ) : null}
    </div>
  );
}
