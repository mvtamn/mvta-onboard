// Client-side image downscale before upload - phone photos are commonly
// several MB each, and resizing in the browser keeps Blob Storage cost and
// load time predictable with no server-side processing needed (per the
// owner's decision in detour-and-event-module-implementation-plan.md,
// Part B3). Plain <canvas>, no new dependency for a basic resize.
const MAX_DIMENSION_PX = 1600;
const JPEG_QUALITY = 0.82;

export async function resizeImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
    return file; // nothing sensible to resize
  }

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file; // unsupported format - upload as-is rather than fail

  const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(bitmap.width, bitmap.height));
  if (scale >= 1) return file; // already small enough

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) return file;

  const resizedName = file.name.replace(/\.\w+$/, "") + ".jpg";
  return new File([blob], resizedName, { type: "image/jpeg" });
}
