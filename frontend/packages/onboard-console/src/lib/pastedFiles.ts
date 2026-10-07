// Files arriving by paste or drop rather than through a file picker.
//
// A screenshot copied with Snipping Tool or Cmd+Ctrl+Shift+4 pastes as a
// File every browser names "image.png", so two pastes onto one detour
// would be two indistinguishable attachments. Those get a timestamped
// name; a file copied from Explorer/Finder keeps the name it already has.

const GENERIC_PASTE_NAME = /^image\.(png|jpe?g|gif|webp|bmp)$/i;

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

export function filesFromTransfer(transfer: DataTransfer | null, now: Date = new Date()): File[] {
  if (!transfer) return [];
  const files = Array.from(transfer.files ?? []);
  let pasteIndex = 0;
  return files.map((file) => {
    if (!GENERIC_PASTE_NAME.test(file.name)) return file;
    pasteIndex += 1;
    const ext = file.name.slice(file.name.lastIndexOf("."));
    const suffix = files.length > 1 ? `-${pasteIndex}` : "";
    return new File([file], `pasted-${stamp(now)}${suffix}${ext}`, { type: file.type, lastModified: file.lastModified });
  });
}
