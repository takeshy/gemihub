import { createRequire } from "node:module";
import path from "node:path";
import { createPdfjsTextExtractor } from "~/engine/pdfPages";

/** pdf.js text extraction on the server, using its Node (legacy) build. */
export const extractPdfTextOnServer = createPdfjsTextExtractor(async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const root = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  return {
    pdfjs: pdfjs as unknown as typeof import("pdfjs-dist"),
    options: {
      cMapUrl: `${root}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${root}/standard_fonts/`,
    },
  };
});
