import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useI18n } from "~/i18n/context";

// Module-scope side effect: consumers must import this component lazily
// (React.lazy) so pdfjs-dist never runs in the server bundle.
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfViewerHandle {
  scrollToPage: (page: number) => void;
  getTextLayer: (page: number) => HTMLElement | null;
  getScrollContainer: () => HTMLElement | null;
  getPageCount: () => number;
  getCurrentPage: () => number;
}

interface PageSlot {
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
  renderedScale: number;
  rendering: boolean;
}

// pdf.js based viewer: canvas rendering plus a text layer per page so quotes
// can be selected, searched, and highlighted (ported from mdwys).
const PdfViewer = forwardRef<PdfViewerHandle, {
  data: Uint8Array | null;
  title: string;
  scalePercent?: number;
  onTextLayerRendered?: (page: number, root: HTMLElement) => void;
  onCurrentPageChange?: (page: number) => void;
}>(function PdfViewer({ data, title, scalePercent = 100, onTextLayerRendered, onCurrentPageChange }, ref) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef(new Map<number, PageSlot>());
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const generationRef = useRef(0);
  const baseWidthRef = useRef(0);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const currentPageRef = useRef(1);
  const [docVersion, setDocVersion] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState("");

  const onTextLayerRenderedRef = useRef(onTextLayerRendered);
  onTextLayerRenderedRef.current = onTextLayerRendered;
  const onCurrentPageChangeRef = useRef(onCurrentPageChange);
  onCurrentPageChangeRef.current = onCurrentPageChange;
  // Read via a ref so renderPage stays referentially stable: zoom changes
  // must re-render page contents without rebuilding the page placeholders
  // (which would reset the scroll position).
  const scalePercentRef = useRef(scalePercent);
  scalePercentRef.current = scalePercent;

  const effectiveScale = useCallback(() => {
    const container = containerRef.current;
    const baseWidth = baseWidthRef.current;
    if (!container || !baseWidth) return scalePercentRef.current / 100;
    const fitWidth = Math.max(0.25, (container.clientWidth - 32) / baseWidth);
    return fitWidth * (scalePercentRef.current / 100);
  }, []);

  const renderPage = useCallback(async (pageNumber: number) => {
    const doc = docRef.current;
    const slot = pagesRef.current.get(pageNumber);
    if (!doc || !slot || slot.rendering) return;
    const generation = generationRef.current;
    const scale = effectiveScale();
    if (slot.renderedScale === scale) return;
    slot.rendering = true;
    try {
      const page = await doc.getPage(pageNumber);
      if (generation !== generationRef.current) return;
      const viewport = page.getViewport({ scale });
      const dpr = Math.min(3, window.devicePixelRatio || 1);

      slot.wrapper.style.width = `${Math.floor(viewport.width)}px`;
      slot.wrapper.style.height = `${Math.floor(viewport.height)}px`;
      slot.wrapper.style.setProperty("--scale-factor", String(viewport.scale));
      slot.wrapper.style.setProperty("--total-scale-factor", String(viewport.scale));
      slot.canvas.width = Math.floor(viewport.width * dpr);
      slot.canvas.height = Math.floor(viewport.height * dpr);
      slot.canvas.style.width = `${Math.floor(viewport.width)}px`;
      slot.canvas.style.height = `${Math.floor(viewport.height)}px`;

      const context = slot.canvas.getContext("2d");
      if (!context) return;
      await page.render({
        canvas: slot.canvas,
        canvasContext: context,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      }).promise;
      if (generation !== generationRef.current) return;

      slot.textLayer.textContent = "";
      const textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: slot.textLayer,
        viewport,
      });
      await textLayer.render();
      if (generation !== generationRef.current) return;

      slot.renderedScale = scale;
      onTextLayerRenderedRef.current?.(pageNumber, slot.textLayer);
    } catch (renderError) {
      console.warn(`Could not render PDF page ${pageNumber}.`, renderError);
    } finally {
      slot.rendering = false;
    }
  }, [effectiveScale]);

  // Load the document whenever the data changes.
  useEffect(() => {
    const container = containerRef.current;
    generationRef.current += 1;
    const generation = generationRef.current;
    setError("");
    setPageCount(0);
    pagesRef.current.clear();
    if (container) container.textContent = "";
    docRef.current?.loadingTask.destroy().catch(() => undefined);
    docRef.current = null;
    if (!data || !container) return;

    let cancelled = false;
    void (async () => {
      try {
        // pdf.js >= 5 removed the eval-based font path entirely, so no
        // isEvalSupported opt-out is needed here.
        // Copy the bytes: getDocument transfers the buffer to the worker,
        // which would detach the caller's (possibly cached) array.
        const doc = await getDocument({ data: data.slice() }).promise;
        if (cancelled || generation !== generationRef.current) {
          doc.loadingTask.destroy().catch(() => undefined);
          return;
        }
        docRef.current = doc;
        const firstPage = await doc.getPage(1);
        if (cancelled || generation !== generationRef.current) return;
        baseWidthRef.current = firstPage.getViewport({ scale: 1 }).width;
        setPageCount(doc.numPages);
        setDocVersion((value) => value + 1);
      } catch (loadError) {
        console.error(loadError);
        if (!cancelled) setError(t("pdf.openFailed"));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Build page placeholders and observe visibility once the document loads.
  useEffect(() => {
    const container = containerRef.current;
    const doc = docRef.current;
    if (!container || !doc || !pageCount) return;

    container.textContent = "";
    pagesRef.current.clear();
    const scale = effectiveScale();
    const baseWidth = baseWidthRef.current || 600;
    const estimatedHeight = Math.floor(baseWidth * scale * 1.4);

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const wrapper = document.createElement("div");
      wrapper.className = "pdf-page";
      wrapper.dataset.pdfPage = String(pageNumber);
      wrapper.style.width = `${Math.floor(baseWidth * scale)}px`;
      wrapper.style.height = `${estimatedHeight}px`;
      const canvas = document.createElement("canvas");
      const textLayer = document.createElement("div");
      textLayer.className = "textLayer";
      wrapper.append(canvas, textLayer);
      container.appendChild(wrapper);
      pagesRef.current.set(pageNumber, { wrapper, canvas, textLayer, renderedScale: 0, rendering: false });
    }

    observerRef.current?.disconnect();
    const observer = new IntersectionObserver((observedEntries) => {
      observedEntries.forEach((observed) => {
        if (!observed.isIntersecting) return;
        const pageNumber = Number((observed.target as HTMLElement).dataset.pdfPage);
        if (pageNumber) void renderPage(pageNumber);
      });
    }, { root: container, rootMargin: "100% 0px" });
    pagesRef.current.forEach((slot) => observer.observe(slot.wrapper));
    observerRef.current = observer;

    return () => observer.disconnect();
  }, [docVersion, pageCount, effectiveScale, renderPage]);

  // Re-render already-rendered pages when the zoom changes.
  useEffect(() => {
    const scale = effectiveScale();
    pagesRef.current.forEach((slot, pageNumber) => {
      if (slot.renderedScale && slot.renderedScale !== scale) {
        slot.renderedScale = 0;
        void renderPage(pageNumber);
      }
    });
  }, [scalePercent, effectiveScale, renderPage]);

  const updateCurrentPage = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    let best = 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    pagesRef.current.forEach((slot, pageNumber) => {
      const rect = slot.wrapper.getBoundingClientRect();
      const distance = rect.bottom <= containerTop ? Number.POSITIVE_INFINITY : Math.abs(rect.top - containerTop);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = pageNumber;
      }
    });
    if (best !== currentPageRef.current) {
      currentPageRef.current = best;
      setCurrentPage(best);
      onCurrentPageChangeRef.current?.(best);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => updateCurrentPage();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [updateCurrentPage, docVersion]);

  const scrollToPage = useCallback((pageNumber: number) => {
    const slot = pagesRef.current.get(pageNumber);
    const container = containerRef.current;
    if (!slot || !container) return;
    container.scrollTo({ top: slot.wrapper.offsetTop - 8, behavior: "smooth" });
    void renderPage(pageNumber);
  }, [renderPage]);

  useImperativeHandle(ref, () => ({
    scrollToPage,
    getTextLayer: (page: number) => pagesRef.current.get(page)?.textLayer ?? null,
    getScrollContainer: () => containerRef.current,
    getPageCount: () => pageCount,
    getCurrentPage: () => currentPageRef.current,
  }), [scrollToPage, pageCount]);

  const pageLabel = useMemo(() => (pageCount ? `${currentPage} / ${pageCount}` : ""), [currentPage, pageCount]);

  return (
    <div className="group relative flex h-full min-h-0 flex-col bg-gray-100 dark:bg-gray-900" aria-label={title}>
      {error ? (
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-gray-500 dark:text-gray-400">{error}</div>
      ) : (
        <>
          <div
            ref={containerRef}
            className="flex min-h-0 flex-1 select-text flex-col gap-3 overflow-auto p-3 [align-items:safe_center]"
          />
          {pageCount > 0 && (
            <div className="absolute top-2 left-1/2 z-[5] flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-700 opacity-50 transition-opacity group-hover:opacity-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200">
              <button
                type="button"
                className="inline-flex cursor-pointer rounded p-0.5 hover:bg-gray-100 disabled:cursor-default disabled:opacity-35 dark:hover:bg-gray-700"
                onClick={() => scrollToPage(Math.max(1, currentPageRef.current - 1))}
                disabled={currentPage <= 1}
                title={t("pdf.prevPage")}
              >
                <ChevronLeft size={14} />
              </button>
              <span>{pageLabel}</span>
              <button
                type="button"
                className="inline-flex cursor-pointer rounded p-0.5 hover:bg-gray-100 disabled:cursor-default disabled:opacity-35 dark:hover:bg-gray-700"
                onClick={() => scrollToPage(Math.min(pageCount, currentPageRef.current + 1))}
                disabled={currentPage >= pageCount}
                title={t("pdf.nextPage")}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
});

export default PdfViewer;
