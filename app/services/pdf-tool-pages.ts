// read_drive_file page ranges for PDFs (browser-safe: pdf-lib only)

import { PDFDocument } from "pdf-lib";
import { extractPdfPageRange, resolvePdfPageRange } from "~/engine/pdfPages";
import { bytesToBase64 } from "~/utils/media-utils";
import type { DriveToolMediaResult } from "./gemini-content-builders";

/** The inclusive 1-based range a read_drive_file call asked for; 0 means unset. */
export interface PdfToolPageRange {
  start: number;
  end: number;
}

export function isPdfToolPageRangeSet(range: PdfToolPageRange): boolean {
  return range.start > 0 || range.end > 0;
}

/**
 * Reads startPage and endPage from tool arguments. Models send numbers, but some
 * quote them, so numeric strings are accepted too.
 */
export function pdfToolPageRangeFromArgs(args: Record<string, unknown>): PdfToolPageRange | { error: string } {
  const page = (key: string): number | string => {
    const raw = args[key];
    if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) return 0;
    const value = typeof raw === "string" ? Number(raw.trim()) : raw;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      return `read_drive_file: '${key}' must be a positive integer`;
    }
    return value;
  };
  const start = page("startPage");
  if (typeof start === "string") return { error: start };
  const end = page("endPage");
  if (typeof end === "string") return { error: end };
  if (start && end && start > end) {
    return { error: "read_drive_file: 'startPage' must be less than or equal to 'endPage'" };
  }
  return { start, end };
}

/**
 * Cuts pages out of a PDF for the model. The range and page count go in the file
 * name, the only text the function response carries next to the document, so the
 * model knows whether more pages remain. An endPage past the last page is clamped.
 */
export async function pdfPagesMediaResult(
  bytes: Uint8Array,
  fileName: string,
  range: PdfToolPageRange,
  maxBytes: number,
): Promise<DriveToolMediaResult | { error: string }> {
  let totalPages: number;
  try {
    totalPages = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
  } catch {
    return { error: `Failed to read the pages of PDF: ${fileName}` };
  }
  let from: number, to: number;
  try {
    ({ from, to } = resolvePdfPageRange(range.start, range.end, totalPages, fileName));
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  const excerpt = await extractPdfPageRange(bytes, from, to);
  if (excerpt.length > maxBytes) {
    return {
      error: `Pages ${from}-${to} of ${fileName} are too large (${Math.round(excerpt.length / 1024 / 1024)}MB). Read a narrower page range.`,
    };
  }
  const base = fileName.split("/").pop() || fileName;
  return {
    __mediaData: {
      mimeType: "application/pdf",
      base64: bytesToBase64(excerpt),
      fileName: `${base.replace(/\.[^.]+$/, "")} (pages ${from}-${to} of ${totalPages}).pdf`,
    },
  };
}
