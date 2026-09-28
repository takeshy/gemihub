import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readPdfForWorkflow, resolvePdfPageRange, wantsPdfPages } from "./pdfPages";
import { extractPdfTextOnServer } from "~/services/pdf-text.server";
import type { ExecutionContext, WorkflowNode } from "./types";

async function buildPdf(...bodies: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const body of bodies) doc.addPage().drawText(body, { x: 50, y: 700, font });
  return await doc.save();
}

function node(properties: Record<string, string>): WorkflowNode {
  return { id: "read", type: "drive-read", properties: { path: "docs/book.pdf", ...properties } };
}

const book = () => buildPdf("page one", "page two", "page three", "page four");
const file = { id: "file-id", name: "docs/book.pdf" };

test("wantsPdfPages only switches PDFs that ask for a page property", () => {
  assert.equal(wantsPdfPages(node({ saveTo: "x" }), "docs/book.pdf", "application/pdf"), false);
  assert.equal(wantsPdfPages(node({ saveTo: "x", startPage: "2" }), "docs/book.pdf", "application/pdf"), true);
  assert.equal(wantsPdfPages(node({ savePageCountTo: "n" }), "book.PDF", "application/octet-stream"), true);
  assert.equal(wantsPdfPages(node({ startPage: "2" }), "notes/a.md", "text/markdown"), false);
});

test("resolvePdfPageRange clamps endPage and rejects a start past the end", () => {
  assert.deepEqual(resolvePdfPageRange(0, 0, 4, "b.pdf"), { from: 1, to: 4 });
  assert.deepEqual(resolvePdfPageRange(3, 99, 4, "b.pdf"), { from: 3, to: 4 });
  assert.throws(() => resolvePdfPageRange(5, 0, 4, "b.pdf"), /exceeds the 4 pages/);
});

test("drive-read reads a PDF page range as labelled text", async () => {
  const context: ExecutionContext = { variables: new Map([["page", 2]]) };
  const summary = await readPdfForWorkflow(
    node({ startPage: "{{page}}", endPage: "3", saveTo: "text", savePageCountTo: "total", saveEndPageTo: "readTo" }),
    context, file, await book(), extractPdfTextOnServer,
  );
  assert.equal(context.variables.get("text"), "[Page 2]\npage two\n\n[Page 3]\npage three");
  assert.equal(context.variables.get("total"), 4);
  assert.equal(context.variables.get("readTo"), 3);
  assert.equal(summary.startPage, 2);

  await readPdfForWorkflow(node({ startPage: "3", endPage: "99", saveEndPageTo: "readTo" }), context, file, await book(), extractPdfTextOnServer);
  assert.equal(context.variables.get("readTo"), 4);
});

test("drive-read with only savePageCountTo counts pages", async () => {
  const context: ExecutionContext = { variables: new Map() };
  const extract = () => Promise.reject(new Error("text must not be extracted"));
  await readPdfForWorkflow(node({ savePageCountTo: "total" }), context, file, await book(), extract);
  assert.equal(context.variables.get("total"), 4);
});

test("drive-read format pdf returns an excerpt as FileExplorerData", async () => {
  const context: ExecutionContext = { variables: new Map() };
  const summary = await readPdfForWorkflow(
    node({ startPage: "2", endPage: "3", format: "pdf", saveTo: "excerpt" }),
    context, file, await book(), extractPdfTextOnServer,
  );
  const data = JSON.parse(String(context.variables.get("excerpt")));
  assert.equal(data.id, "file-id");
  assert.equal(data.basename, "book (pages 2-3).pdf");
  assert.equal(data.contentType, "binary");
  assert.equal("data" in summary, false);
  const excerpt = await PDFDocument.load(Buffer.from(data.data, "base64"));
  assert.equal(excerpt.getPageCount(), 2);
});

test("drive-read rejects invalid page properties", async () => {
  const context: ExecutionContext = { variables: new Map() };
  for (const properties of [
    { startPage: "1.5", saveTo: "t" },
    { startPage: "3", endPage: "2", saveTo: "t" },
    { startPage: "5", saveTo: "t" },
    { format: "markdown", saveTo: "t" },
  ]) {
    await assert.rejects(readPdfForWorkflow(node(properties), context, file, await book(), extractPdfTextOnServer));
  }
});
