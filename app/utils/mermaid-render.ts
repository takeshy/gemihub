/**
 * Serialized Mermaid rendering queue.
 *
 * mermaid.render() uses global internal state, so concurrent calls can corrupt
 * each other (producing empty SVG / blank diagrams). This utility ensures only
 * one render runs at a time across the entire app and retries once on failure.
 */

// Global queue — chains all render calls so they never overlap.
let queue: Promise<void> = Promise.resolve();

export interface MermaidRenderOptions {
  chart: string;
  isDark: boolean;
  /** Override flowchart.useMaxWidth (default: false) */
  useMaxWidth?: boolean;
}

export interface MermaidRenderResult {
  svg: string;
}

export function enqueueMermaidRender(
  options: MermaidRenderOptions,
  isCancelled: () => boolean,
): Promise<MermaidRenderResult | null> {
  let resolve: (v: MermaidRenderResult | null) => void;
  let reject: (e: unknown) => void;
  const promise = new Promise<MermaidRenderResult | null>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  // Catch inside the chain so the queue never rejects (which would block
  // all subsequent renders). Errors are forwarded to the caller's promise.
  queue = queue.then(async () => {
    try {
      const result = await doRender(options, isCancelled, 0);
      resolve!(result);
    } catch (e) {
      reject!(e);
    }
  });

  return promise;
}

async function doRender(
  options: MermaidRenderOptions,
  isCancelled: () => boolean,
  attempt: number,
): Promise<MermaidRenderResult | null> {
  if (isCancelled() || !options.chart) return null;

  const id = `mermaid-${Date.now()}-${attempt}`;
  try {
    const mermaid = (await import("mermaid")).default;
    if (isCancelled()) return null;

    mermaid.initialize({
      startOnLoad: false,
      theme: options.isDark ? "dark" : "default",
      flowchart: {
        useMaxWidth: options.useMaxWidth ?? false,
        htmlLabels: true,
        curve: "basis",
      },
      securityLevel: "strict",
      suppressErrorRendering: true,
    });

    const { svg } = await mermaid.render(id, options.chart);
    if (isCancelled()) return null;
    return { svg };
  } catch (e) {
    document.getElementById(id)?.remove();
    if (isCancelled()) return null;

    // Retry once after a short delay — transient failures from concurrent
    // state corruption can happen when switching files quickly.
    if (attempt < 1) {
      await new Promise((r) => setTimeout(r, 100));
      if (isCancelled()) return null;
      return doRender(options, isCancelled, attempt + 1);
    }
    throw e;
  }
}
