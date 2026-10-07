import { useEffect, useState, type ClipboardEvent, type ReactNode } from "react";
import { ApiError, type DetourImage } from "@mvta/shared";
import { api } from "../config.js";
import { resizeImageFile } from "../lib/imageResize.js";
import { filesFromTransfer } from "../lib/pastedFiles.js";

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
//
// Files can come in three ways: the picker, a drop onto the zone, or a
// paste (a screenshot copied to the clipboard) anywhere in the surrounding
// form - OCC asked for paste because the map is usually a snip out of an
// email, and saving it to disk first just to re-pick it was the friction.

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

// One file to one Detour: resize, PUT to Blob via SAS, then record it.
export async function uploadDetourAttachment(detourId: string, rawFile: File): Promise<void> {
  const file = await resizeImageFile(rawFile);
  const contentType = file.type || "application/octet-stream";
  const { upload_url, blob_path } = await api.getDetourImageUploadUrl(detourId, file.name, contentType);
  const putRes = await fetch(upload_url, { method: "PUT", headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": contentType }, body: file });
  if (!putRes.ok) throw new Error(`Upload to storage failed (${putRes.status})`);
  await api.createDetourImage(detourId, { blob_path, file_name: file.name, content_type: contentType, size_bytes: file.size });
}

// onPaste for a whole form: a clipboard holding files becomes attachments.
// Pasting into a text field still pastes text when the clipboard has any -
// Word and Outlook put a picture of the copied text on the clipboard
// alongside the text itself, and that must not turn into an attachment.
export function pasteFilesHandler(onFiles: (files: File[]) => void) {
  return (e: ClipboardEvent) => {
    const files = filesFromTransfer(e.clipboardData);
    if (files.length === 0) return;
    const target = e.target as HTMLElement;
    const inTextField = target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type !== "file") || target.isContentEditable;
    if (inTextField && e.clipboardData.getData("text/plain")) return;
    e.preventDefault();
    onFiles(files);
  };
}

// Picker + drop target. It takes focus when clicked so a paste has
// somewhere to land; the paste itself is handled by the form around it
// (pasteFilesHandler), so Ctrl+V works from anywhere in that form too.
// Only "browse" opens the file picker - a click anywhere on the zone
// opening it would make click-then-paste impossible.
export function AttachmentDropzone({ onFiles, disabled, children }: { onFiles: (files: File[]) => void; disabled?: boolean; children?: ReactNode }) {
  const [over, setOver] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <div
      className={`dropzone${over ? " is-over" : ""}`}
      tabIndex={disabled ? -1 : 0}
      aria-label="Attach files: drop, paste, or browse"
      style={disabled ? { cursor: "default", opacity: 0.6 } : { cursor: "default" }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onDragOver={(e) => { if (disabled) return; e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (disabled) return; const files = filesFromTransfer(e.dataTransfer); if (files.length) onFiles(files); }}
    >
      <IconUpload />
      <span>
        {children ?? (focused
          ? <>Ready - press <b>Ctrl+V</b> to paste a screenshot, or <BrowseLink disabled={disabled} onFiles={onFiles} />.</>
          : <>Drop files here, click here and paste a screenshot (Ctrl+V), or <BrowseLink disabled={disabled} onFiles={onFiles} />. Images, PDF, Office, CSV, text.</>)}
      </span>
    </div>
  );
}

function BrowseLink({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  return (
    <label style={{ cursor: disabled ? "default" : "pointer" }}>
      <b style={{ textDecoration: "underline" }}>browse</b>
      <input type="file" accept={DETOUR_ATTACHMENT_ACCEPT} multiple disabled={disabled} style={{ display: "none" }} onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) onFiles(files); }} />
    </label>
  );
}

// Files picked before the Detour exists to hold them - the new-detour form
// uploads these once Save has an id.
export function StagedAttachments({ files, onRemove, note = "will upload on save" }: { files: File[]; onRemove: (index: number) => void; note?: string }) {
  if (files.length === 0) return null;
  return (
    <div className="file-tiles" style={{ marginTop: 8 }}>
      {files.map((file, index) => (
        <span key={`${file.name}-${index}`} className="file-tile">
          <span className="file-tile-kind">{extensionLabel(file.name, file.type || null).slice(0, 4)}</span>
          <span><b>{file.name}</b><small>{sizeLabel(file.size)} · {note}</small></span>
          <button type="button" className="btn-icon-sm" aria-label={`Remove ${file.name}`} onClick={() => onRemove(index)}>×</button>
        </span>
      ))}
    </div>
  );
}

const IconUpload = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4M6 10l6-6 6 6M4 20h16" /></svg>;

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

  async function handleFiles(fileList: File[]) {
    setUploading(true);
    setError(null);
    try {
      for (const rawFile of fileList) await uploadDetourAttachment(detourId, rawFile);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }} onPaste={canWrite && !uploading ? pasteFilesHandler((f) => void handleFiles(f)) : undefined}>
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
        <AttachmentDropzone disabled={uploading} onFiles={(f) => void handleFiles(f)}>
          {uploading ? "Uploading…" : undefined}
        </AttachmentDropzone>
      ) : null}
    </div>
  );
}
