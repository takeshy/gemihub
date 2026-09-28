import { createPdfjsTextExtractor } from "../pdfPages";

/**
 * pdf.js text extraction in the browser. pdfjs-dist sets up its worker at module
 * scope, so it is imported on first use to keep it out of the server bundle.
 */
export const extractPdfTextInBrowser = createPdfjsTextExtractor(async () => {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  // CJK PDFs can need Adobe character maps; PdfViewer serves them from here too.
  const assetBase = `${import.meta.env.BASE_URL}pdfjs/${pdfjs.version}/`;
  return {
    pdfjs,
    options: {
      cMapUrl: `${assetBase}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assetBase}standard_fonts/`,
      wasmUrl: `${assetBase}wasm/`,
    },
  };
});
