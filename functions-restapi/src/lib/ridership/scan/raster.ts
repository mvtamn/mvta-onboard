// PDF pages to grayscale pixels, and grayscale pixels to JPEG
// (plans/count-sheet-scan-upload.md §2, increment S1).
//
// pdfjs-dist renders the page and @napi-rs/canvas is its canvas in Node. Both
// are pure npm installs: canvas ships a prebuilt binary per platform, and the
// API workflow runs `npm ci` on ubuntu-latest, so the deployed package carries
// the linux-x64-gnu one the Function App needs.
//
// pdfjs-dist is ESM only. This package is CommonJS, and Node 22+ can
// require() an ES module that has no top-level await, which is how it is
// loaded here (TypeScript would compile a dynamic import() to require anyway).
import path from "node:path";
import type { Gray } from "./geometry";

/** What the page's text layer says: a searchable PDF from the MFP, or a sheet straight from countSheetPdf. */
export interface TextItem {
  str: string;
  /** The glyph height in points. The BLOCK number is 34 pt, the date 13 pt. */
  height: number;
}

export interface RasterPage {
  image: Gray;
  /** Pixels per PDF point at which `image` was drawn. */
  scale: number;
  /** The page's size in points, as the PDF declares it. */
  widthPt: number;
  heightPt: number;
  text: TextItem[];
}

// The pdfjs surface used here. Typed by hand: its own .d.mts types do not
// resolve under this package's CommonJS module resolution.
interface PdfViewport { width: number; height: number }
interface PdfPage {
  getViewport(o: { scale: number }): PdfViewport;
  render(o: { canvasContext: unknown; viewport: PdfViewport; background?: string }): { promise: Promise<void> };
  getTextContent(): Promise<{ items: Array<{ str?: string; transform?: number[]; height?: number }> }>;
  cleanup(): void;
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  canvasFactory: { create(w: number, h: number): { canvas: unknown; context: CanvasContextLike } };
}
interface CanvasContextLike {
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}
interface PdfJs {
  getDocument(o: Record<string, unknown>): PdfLoadingTask;
}
interface PdfLoadingTask {
  promise: Promise<PdfDocument>;
  destroy(): Promise<void>;
}

let pdfjs: PdfJs | null = null;
function loadPdfJs(): PdfJs {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  pdfjs ??= require("pdfjs-dist/legacy/build/pdf.mjs") as PdfJs;
  return pdfjs;
}

function assetDir(sub: string): string {
  return `${path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), sub)}${path.sep}`;
}

/** Opens the PDF; the caller destroys the returned task when done, which frees the document. */
function openPdf(bytes: Uint8Array): PdfLoadingTask {
  return loadPdfJs().getDocument({
    // pdfjs takes ownership of (and detaches) the buffer it is handed.
    data: new Uint8Array(bytes),
    // The standard 14 fonts are not embedded by pdfkit; pdfjs needs their data to draw them.
    standardFontDataUrl: assetDir("standard_fonts"),
    wasmUrl: assetDir("wasm"),
    cMapUrl: assetDir("cmaps"),
    cMapPacked: true,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });
}

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const task = openPdf(bytes);
  try {
    return (await task.promise).numPages;
  } finally {
    await task.destroy();
  }
}

/** One page (0-based) drawn at `dpi`, white behind it, as gray. */
export async function rasterizePage(bytes: Uint8Array, pageIndex: number, dpi: number): Promise<RasterPage> {
  const task = openPdf(bytes);
  try {
    const doc = await task.promise;
    if (pageIndex < 0 || pageIndex >= doc.numPages) throw new RangeError(`Page ${pageIndex + 1} is not in a ${doc.numPages}-page PDF.`);
    const page = await doc.getPage(pageIndex + 1);
    const scale = dpi / 72;
    const viewport = page.getViewport({ scale });
    const width = Math.round(viewport.width);
    const height = Math.round(viewport.height);
    const { context } = doc.canvasFactory.create(width, height);
    await page.render({ canvasContext: context, viewport, background: "rgb(255,255,255)" }).promise;
    const rgba = context.getImageData(0, 0, width, height).data;
    const data = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < data.length; i++, j += 4) {
      // Luma, with transparent pixels read as the white paper behind them.
      const a = rgba[j + 3] / 255;
      data[i] = Math.round((0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) * a + 255 * (1 - a));
    }
    const content = await page.getTextContent();
    const text = content.items
      .filter((item): item is { str: string; transform?: number[]; height?: number } => typeof item.str === "string" && item.str.trim() !== "")
      .map((item) => ({ str: item.str, height: Math.abs(item.transform?.[3] ?? item.height ?? 0) }));
    page.cleanup();
    return { image: { width, height, data }, scale, widthPt: viewport.width / scale, heightPt: viewport.height / scale, text };
  } finally {
    await task.destroy();
  }
}

interface NapiCanvasModule {
  createCanvas(w: number, h: number): {
    getContext(kind: "2d"): { createImageData(w: number, h: number): { data: Uint8ClampedArray }; putImageData(d: unknown, x: number, y: number): void };
    encode(format: "jpeg" | "png", quality?: number): Promise<Buffer>;
  };
}

/** A gray image as JPEG, for the stored page image. */
export async function encodeJpeg(image: Gray, quality = 82): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createCanvas } = require("@napi-rs/canvas") as NapiCanvasModule;
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  const out = ctx.createImageData(image.width, image.height);
  for (let i = 0, j = 0; i < image.data.length; i++, j += 4) {
    out.data[j] = out.data[j + 1] = out.data[j + 2] = image.data[i];
    out.data[j + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas.encode("jpeg", quality);
}
