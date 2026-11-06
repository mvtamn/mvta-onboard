// Straightening a scanned Count Sheet on its four corner marks
// (plans/count-sheet-scan-upload.md §2 step 2, and the feasibility check).
//
// The sheet prints four solid 12 pt squares, inset 18 pt from each corner of
// US Letter (countSheetPdf.ts, cornerMarks). Finding them gives four points
// whose true positions are known, and the homography between the two maps
// every printed box to within a pixel. Everything here is pure arithmetic on a
// gray image, so it is tested on synthetic sheets without Azure.
//
// The finder has to know a mark's size: the QR code's finder patterns are
// squares in the same top-right corner. Those are rings, though, not solid, so
// a solid-fill test as well as a size test tells them apart.

/** 8-bit gray, row-major, 0 black to 255 white. */
export interface Gray {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface Point {
  x: number;
  y: number;
}

/** US Letter in points, as countSheetPdf.ts lays it out. */
export const PAGE_PT = { width: 612, height: 792 } as const;
const MARK_SIDE_PT = 12;
const MARK_INSET_PT = 18;
const MARK_CENTRE = MARK_INSET_PT + MARK_SIDE_PT / 2;

/** Where each mark's centre is printed, in points: top-left, top-right, bottom-left, bottom-right. */
export const MARK_CENTRES_PT: readonly Point[] = [
  { x: MARK_CENTRE, y: MARK_CENTRE },
  { x: PAGE_PT.width - MARK_CENTRE, y: MARK_CENTRE },
  { x: MARK_CENTRE, y: PAGE_PT.height - MARK_CENTRE },
  { x: PAGE_PT.width - MARK_CENTRE, y: PAGE_PT.height - MARK_CENTRE },
];

const DARK = 140;

/** The share of pixels darker than the ink threshold, over the whole image or a box of it. */
export function inkRatio(image: Gray, box?: { x: number; y: number; w: number; h: number }): number {
  const x0 = Math.max(0, Math.floor(box?.x ?? 0));
  const y0 = Math.max(0, Math.floor(box?.y ?? 0));
  const x1 = Math.min(image.width, Math.ceil(box ? box.x + box.w : image.width));
  const y1 = Math.min(image.height, Math.ceil(box ? box.y + box.h : image.height));
  let dark = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * image.width;
    for (let x = x0; x < x1; x++) {
      total++;
      if (image.data[row + x] < DARK) dark++;
    }
  }
  return total === 0 ? 0 : dark / total;
}

/**
 * A blank back: almost no ink once the scanner's edge shadow is cut off.
 * "This side intentionally blank" alone is well under the threshold.
 */
export function looksBlank(image: Gray): boolean {
  const mx = image.width * 0.06;
  const my = image.height * 0.06;
  return inkRatio(image, { x: mx, y: my, w: image.width - 2 * mx, h: image.height - 2 * my }) < 0.004;
}

interface Blob {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  count: number;
  cx: number;
  cy: number;
}

/** Connected dark regions (4-neighbour) inside a window of the image. */
function blobsIn(image: Gray, x0: number, y0: number, x1: number, y1: number, maxCount: number): Blob[] {
  const w = x1 - x0;
  const h = y1 - y0;
  const seen = new Uint8Array(w * h);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (seen[i] || image.data[(y + y0) * image.width + x + x0] >= DARK) continue;
      seen[i] = 1;
      stack.push(i);
      const blob: Blob = { minX: x, maxX: x, minY: y, maxY: y, count: 0, cx: 0, cy: 0 };
      let sx = 0;
      let sy = 0;
      while (stack.length > 0) {
        const j = stack.pop()!;
        const px = j % w;
        const py = (j - px) / w;
        blob.count++;
        sx += px;
        sy += py;
        if (px < blob.minX) blob.minX = px;
        if (px > blob.maxX) blob.maxX = px;
        if (py < blob.minY) blob.minY = py;
        if (py > blob.maxY) blob.maxY = py;
        // A region far bigger than a mark (a dark scanner edge) is still
        // walked, so its pixels are not revisited, but it is never a candidate.
        for (const k of [px > 0 ? j - 1 : -1, px < w - 1 ? j + 1 : -1, py > 0 ? j - w : -1, py < h - 1 ? j + w : -1]) {
          if (k < 0 || seen[k]) continue;
          const kx = k % w;
          const ky = (k - kx) / w;
          if (image.data[(ky + y0) * image.width + kx + x0] >= DARK) continue;
          seen[k] = 1;
          stack.push(k);
        }
      }
      if (blob.count > maxCount) continue;
      blob.cx = sx / blob.count + x0;
      blob.cy = sy / blob.count + y0;
      blob.minX += x0;
      blob.maxX += x0;
      blob.minY += y0;
      blob.maxY += y0;
      blobs.push(blob);
    }
  }
  return blobs;
}

/**
 * The four marks' centres in pixels, in MARK_CENTRES_PT order, or which are
 * missing. `scale` is pixels per point: the page is assumed to be about
 * Letter-sized, as an MFP scan of the sheet is.
 */
export function findCornerMarks(image: Gray, scale: number): { marks: Point[] } | { missing: number[] } {
  const side = MARK_SIDE_PT * scale;
  const corners: Point[] = [
    { x: 0, y: 0 },
    { x: image.width, y: 0 },
    { x: 0, y: image.height },
    { x: image.width, y: image.height },
  ];
  // Generous windows: a sheet fed a little crooked or offset still has its
  // mark well inside the outer fifth of the page.
  const ww = Math.round(image.width * 0.2);
  const wh = Math.round(image.height * 0.16);
  const marks: Point[] = [];
  const missing: number[] = [];
  corners.forEach((corner, index) => {
    const x0 = corner.x === 0 ? 0 : image.width - ww;
    const y0 = corner.y === 0 ? 0 : image.height - wh;
    const candidates = blobsIn(image, x0, y0, x0 + ww, y0 + wh, side * side * 3).filter((b) => {
      const bw = b.maxX - b.minX + 1;
      const bh = b.maxY - b.minY + 1;
      return bw >= side * 0.6 && bw <= side * 1.6 && bh >= side * 0.6 && bh <= side * 1.6
        && b.count >= side * side * 0.5
        && b.count / (bw * bh) >= 0.6;
    });
    const best = candidates.sort((a, b) => Math.hypot(a.cx - corner.x, a.cy - corner.y) - Math.hypot(b.cx - corner.x, b.cy - corner.y))[0];
    if (best) marks.push({ x: best.cx, y: best.cy });
    else missing.push(index);
  });
  return missing.length > 0 ? { missing } : { marks };
}

/** 3x3 row-major, h[8] = 1. */
export type Homography = number[];

/** The homography taking each `from` point to its `to` point (four pairs, exact). */
export function homography(from: readonly Point[], to: readonly Point[]): Homography {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8x9 augmented matrix.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error("Corner marks are degenerate.");
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c < 9; c++) a[r][c] -= f * a[col][c];
    }
  }
  return [...a.map((row, i) => row[8] / a[i][i]), 1];
}

export function project(h: Homography, p: Point): Point {
  const d = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / d, y: (h[3] * p.x + h[4] * p.y + h[5]) / d };
}

/**
 * Whether four found marks are a sheet: the distances between them agree with
 * the printed page to within 8%, and opposite sides agree with each other to
 * within 3%, which an MFP scan always meets and a wrong blob rarely does.
 */
export function plausibleMarks(marks: readonly Point[], scale: number): boolean {
  const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const top = d(marks[0], marks[1]);
  const bottom = d(marks[2], marks[3]);
  const left = d(marks[0], marks[2]);
  const right = d(marks[1], marks[3]);
  const wide = (PAGE_PT.width - 2 * MARK_CENTRE) * scale;
  const tall = (PAGE_PT.height - 2 * MARK_CENTRE) * scale;
  const near = (x: number, want: number, tol: number) => Math.abs(x - want) <= want * tol;
  return near(top, wide, 0.08) && near(bottom, wide, 0.08) && near(left, tall, 0.08) && near(right, tall, 0.08)
    && near(top, bottom, 0.03) && near(left, right, 0.03);
}

/**
 * The sheet redrawn upright at `outScale` pixels per point: each output pixel
 * looks up where it lies on the scan through the homography, with bilinear
 * sampling. Anything off the scan is white.
 */
export function warp(image: Gray, canonicalToScan: Homography, outScale: number): Gray {
  const width = Math.round(PAGE_PT.width * outScale);
  const height = Math.round(PAGE_PT.height * outScale);
  const data = new Uint8Array(width * height);
  const h = canonicalToScan;
  for (let oy = 0; oy < height; oy++) {
    const py = (oy + 0.5) / outScale;
    for (let ox = 0; ox < width; ox++) {
      const px = (ox + 0.5) / outScale;
      const d = h[6] * px + h[7] * py + h[8];
      const sx = (h[0] * px + h[1] * py + h[2]) / d - 0.5;
      const sy = (h[3] * px + h[4] * py + h[5]) / d - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= image.width || y0 + 1 >= image.height) {
        data[oy * width + ox] = 255;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      const i = y0 * image.width + x0;
      const top = image.data[i] * (1 - fx) + image.data[i + 1] * fx;
      const bottom = image.data[i + image.width] * (1 - fx) + image.data[i + image.width + 1] * fx;
      data[oy * width + ox] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
  return { width, height, data };
}

export type Straightened =
  | { ok: true; image: Gray; scale: number }
  | { ok: false; reason: "marks_missing" | "marks_implausible" | "marks_not_confirmed"; missing?: number[] };

/**
 * The scan as the printed page, upright, at `outScale` pixels per point. The
 * result is checked by finding the marks again where they were printed: a
 * warp that put any of them more than a third of a mark away is refused.
 */
export function straighten(scan: Gray, scanScale: number, outScale: number): Straightened {
  const found = findCornerMarks(scan, scanScale);
  if ("missing" in found) return { ok: false, reason: "marks_missing", missing: found.missing };
  if (!plausibleMarks(found.marks, scanScale)) return { ok: false, reason: "marks_implausible" };
  const h = homography(MARK_CENTRES_PT, found.marks);
  const image = warp(scan, h, outScale);
  const again = findCornerMarks(image, outScale);
  if ("missing" in again) return { ok: false, reason: "marks_not_confirmed", missing: again.missing };
  const tolerance = (MARK_SIDE_PT / 3) * outScale;
  const confirmed = again.marks.every((m, i) => Math.hypot(m.x - MARK_CENTRES_PT[i].x * outScale, m.y - MARK_CENTRES_PT[i].y * outScale) <= tolerance);
  return confirmed ? { ok: true, image, scale: outScale } : { ok: false, reason: "marks_not_confirmed" };
}

/** A box of the image, in points on the straightened page. */
export function cropPt(image: Gray, scale: number, box: { x: number; y: number; w: number; h: number }): Gray {
  const x0 = Math.max(0, Math.round(box.x * scale));
  const y0 = Math.max(0, Math.round(box.y * scale));
  const x1 = Math.min(image.width, Math.round((box.x + box.w) * scale));
  const y1 = Math.min(image.height, Math.round((box.y + box.h) * scale));
  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) data.set(image.data.subarray((y + y0) * image.width + x0, (y + y0) * image.width + x0 + width), y * width);
  return { width, height, data };
}

/** Gray to the RGBA a QR decoder wants. */
export function toRgba(image: Gray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(image.width * image.height * 4);
  for (let i = 0, j = 0; i < image.data.length; i++, j += 4) {
    out[j] = out[j + 1] = out[j + 2] = image.data[i];
    out[j + 3] = 255;
  }
  return out;
}

/**
 * How alike two same-sized gray images are, as zero-mean normalised cross
 * correlation, at the best of small shifts of `b` (a scan never lands on the
 * exact pixel). 1 is identical; text that differs in a digit scores lower.
 */
export function bestCorrelation(a: Gray, b: Gray, maxShift = 3): number {
  let best = -1;
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = maxShift; y < a.height - maxShift; y++) {
        for (let x = maxShift; x < a.width - maxShift; x++) {
          const va = a.data[y * a.width + x];
          const by = y + dy;
          const bx = x + dx;
          if (by < 0 || bx < 0 || by >= b.height || bx >= b.width) continue;
          const vb = b.data[by * b.width + bx];
          n++; sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
        }
      }
      if (n === 0) continue;
      const cov = sab - (sa * sb) / n;
      const den = Math.sqrt((saa - (sa * sa) / n) * (sbb - (sb * sb) / n));
      const r = den === 0 ? 0 : cov / den;
      if (r > best) best = r;
    }
  }
  return best;
}
