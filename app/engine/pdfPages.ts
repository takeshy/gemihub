import { PDFDocument } from "pdf-lib";
import type { ExecutionContext, FileExplorerData, WorkflowNode } from "./types";
import { replaceVariables } from "./handlers/utils";
import { bytesToBase64 } from "~/utils/media-utils";

/** Text of one PDF page, 1-based. */
export interface PdfPageText {
  number: number;
  text: string;
}

/**
 * Loads a PDF once, picks the page range from its page count, and extracts the
 * text layer of those pages. pdf.js loads differently in the browser and on the
 * server, so each executor passes its own implementation.
 */
export type PdfTextExtractor = (
  bytes: Uint8Array,
  selectRange: (totalPages: number) => { from: number; to: number },
) => Promise<{ totalPages: number; from: number; to: number; pages: PdfPageText[] }>;

const PDF_PAGE_PROPERTIES = ["startPage", "endPage", "format", "savePageCountTo", "saveEndPageTo"];

/**
 * A drive-read of a PDF uses the page-range reader only when it asks for one of
 * its properties; otherwise the whole file comes back as FileExplorerData.
 */
export function wantsPdfPages(node: WorkflowNode, fileName: string, mimeType: string): boolean {
  return (mimeType === "application/pdf" || /\.pdf$/i.test(fileName)) &&
    PDF_PAGE_PROPERTIES.some((key) => !!node.properties[key]);
}

function pageProperty(node: WorkflowNode, key: string, context: ExecutionContext): number {
  const value = replaceVariables(node.properties[key] || "", context).trim();
  if (!value) return 0;
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`${node.type} ${key} must be a positive integer: ${value}`);
  }
  return page;
}

/**
 * Clamps a requested range to a document of totalPages pages. Zero means the
 * first or last page, and an endPage past the last page is clamped, so a
 * workflow can loop over fixed-size chunks without knowing the page count.
 */
export function resolvePdfPageRange(
  startPage: number,
  endPage: number,
  totalPages: number,
  path: string,
): { from: number; to: number } {
  const from = startPage || 1;
  if (from > totalPages) {
    throw new Error(`startPage ${from} exceeds the ${totalPages} pages of "${path}"`);
  }
  const to = endPage && endPage < totalPages ? endPage : totalPages;
  return { from, to };
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  return await PDFDocument.load(bytes, { ignoreEncryption: true });
}

export async function extractPdfPageRange(bytes: Uint8Array, from: number, to: number): Promise<Uint8Array> {
  const source = await loadPdf(bytes);
  const excerpt = await PDFDocument.create();
  const pages = await excerpt.copyPages(
    source,
    Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i),
  );
  for (const page of pages) excerpt.addPage(page);
  return await excerpt.save();
}

/** Names the excerpt of a PDF so different ranges of one file stay distinct. */
export function pdfPagesFileName(fileName: string, from: number, to: number): string {
  return `${fileName.replace(/\.[^./]+$/, "")} (pages ${from}-${to}).pdf`;
}

/**
 * drive-read on a PDF: reads startPage..endPage as its "[Page N]"-labelled text
 * layer or, with format: pdf, as an excerpt PDF (FileExplorerData) for command
 * attachments. savePageCountTo and saveEndPageTo return the page count and the
 * last page read; with only savePageCountTo it counts pages without reading text.
 * Returns a summary for the run log, which never holds the excerpt bytes.
 */
export async function readPdfForWorkflow(
  node: WorkflowNode,
  context: ExecutionContext,
  file: { id?: string; name: string },
  bytes: Uint8Array,
  extractText: PdfTextExtractor,
): Promise<Record<string, unknown>> {
  const saveTo = node.properties["saveTo"];
  const savePageCountTo = node.properties["savePageCountTo"];
  const saveEndPageTo = node.properties["saveEndPageTo"];
  if (!saveTo && !savePageCountTo && !saveEndPageTo) {
    throw new Error("drive-read node missing 'saveTo' property");
  }
  const format = replaceVariables(node.properties["format"] || "", context).trim() || "text";
  if (format !== "text" && format !== "pdf") {
    throw new Error(`drive-read format must be text or pdf: ${format}`);
  }
  const startPage = pageProperty(node, "startPage", context);
  const endPage = pageProperty(node, "endPage", context);
  if (startPage && endPage && startPage > endPage) {
    throw new Error("drive-read startPage must be less than or equal to endPage");
  }

  if (!saveTo && !saveEndPageTo) {
    const totalPages = (await loadPdf(bytes)).getPageCount();
    context.variables.set(savePageCountTo!, totalPages);
    return { path: file.name, totalPages };
  }

  if (format === "text") {
    const { totalPages, from, to, pages } = await extractText(
      bytes,
      (total) => resolvePdfPageRange(startPage, endPage, total, file.name),
    );
    const text = pages
      .map((page) => ({ number: page.number, text: page.text.trim() }))
      .filter((page) => page.text)
      .map((page) => `[Page ${page.number}]\n${page.text}`)
      .join("\n\n");
    if (saveTo) context.variables.set(saveTo, text);
    if (savePageCountTo) context.variables.set(savePageCountTo, totalPages);
    if (saveEndPageTo) context.variables.set(saveEndPageTo, to);
    return { path: file.name, totalPages, startPage: from, endPage: to, text };
  }

  const totalPages = (await loadPdf(bytes)).getPageCount();
  const { from, to } = resolvePdfPageRange(startPage, endPage, totalPages, file.name);
  const excerpt = await extractPdfPageRange(bytes, from, to);
  const basename = pdfPagesFileName(file.name.split("/").pop() || file.name, from, to);
  const fileData: FileExplorerData = {
    ...(file.id ? { id: file.id } : {}),
    path: file.name,
    basename,
    name: basename.replace(/\.pdf$/, ""),
    extension: "pdf",
    mimeType: "application/pdf",
    contentType: "binary",
    data: bytesToBase64(excerpt),
  };
  if (saveTo) context.variables.set(saveTo, JSON.stringify(fileData));
  if (savePageCountTo) context.variables.set(savePageCountTo, totalPages);
  if (saveEndPageTo) context.variables.set(saveEndPageTo, to);
  return { path: file.name, totalPages, startPage: from, endPage: to, fileName: basename };
}

type Pdfjs = typeof import("pdfjs-dist");

/**
 * Builds a PdfTextExtractor on pdf.js. `load` supplies the module and the
 * getDocument options (character maps, standard fonts) for the running side.
 */
export function createPdfjsTextExtractor(
  load: () => Promise<{ pdfjs: Pdfjs; options: Record<string, unknown> }>,
): PdfTextExtractor {
  return async (bytes, selectRange) => {
    const { pdfjs, options } = await load();
    // getDocument transfers the buffer to its worker; keep the caller's bytes intact.
    const task = pdfjs.getDocument({ ...options, data: bytes.slice() });
    try {
      const doc = await task.promise;
      const { from, to } = selectRange(doc.numPages);
      const pages: PdfPageText[] = [];
      for (let number = from; number <= to; number++) {
        const content = await (await doc.getPage(number)).getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
          .join("");
        pages.push({ number, text });
      }
      return { totalPages: doc.numPages, from, to, pages };
    } finally {
      await task.destroy();
    }
  };
}
