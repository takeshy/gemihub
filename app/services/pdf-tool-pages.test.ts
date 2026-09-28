import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { isPdfToolPageRangeSet, pdfPagesMediaResult, pdfToolPageRangeFromArgs } from "./pdf-tool-pages";

async function buildPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) doc.addPage().drawText(`page ${i}`, { x: 50, y: 700, font });
  return await doc.save();
}

test("pdfToolPageRangeFromArgs accepts numbers and numeric strings", () => {
  assert.deepEqual(pdfToolPageRangeFromArgs({ fileId: "x" }), { start: 0, end: 0 });
  assert.deepEqual(pdfToolPageRangeFromArgs({ startPage: 2, endPage: "3" }), { start: 2, end: 3 });
  assert.equal(isPdfToolPageRangeSet({ start: 0, end: 0 }), false);
  assert.equal(isPdfToolPageRangeSet({ start: 0, end: 4 }), true);
  for (const args of [{ startPage: 0 }, { startPage: 1.5 }, { endPage: "two" }, { startPage: 3, endPage: 2 }]) {
    assert.ok("error" in pdfToolPageRangeFromArgs(args), JSON.stringify(args));
  }
});

test("pdfPagesMediaResult sends only the range and reports the page count in its name", async () => {
  const result = await pdfPagesMediaResult(await buildPdf(4), "docs/book.pdf", { start: 2, end: 3 }, 20 * 1024 * 1024);
  assert.ok("__mediaData" in result);
  assert.equal(result.__mediaData.fileName, "book (pages 2-3 of 4).pdf");
  assert.equal(result.__mediaData.mimeType, "application/pdf");
  const excerpt = await PDFDocument.load(Buffer.from(result.__mediaData.base64, "base64"));
  assert.equal(excerpt.getPageCount(), 2);
});

test("pdfPagesMediaResult clamps endPage, rejects a start past the end, and enforces the size limit", async () => {
  const pdf = await buildPdf(4);
  const clamped = await pdfPagesMediaResult(pdf, "book.pdf", { start: 3, end: 99 }, 20 * 1024 * 1024);
  assert.ok("__mediaData" in clamped);
  assert.equal(clamped.__mediaData.fileName, "book (pages 3-4 of 4).pdf");
  const past = await pdfPagesMediaResult(pdf, "book.pdf", { start: 5, end: 0 }, 20 * 1024 * 1024);
  assert.ok("error" in past && /exceeds the 4 pages/.test(past.error));
  const tooLarge = await pdfPagesMediaResult(pdf, "book.pdf", { start: 1, end: 4 }, 10);
  assert.ok("error" in tooLarge && /narrower page range/.test(tooLarge.error));
});
