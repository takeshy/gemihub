/**
 * Execute JavaScript code in a sandboxed iframe.
 *
 * Security:
 * - iframe `sandbox="allow-scripts"` (no `allow-same-origin`) → opaque origin,
 *   no parent DOM / cookies / localStorage / IndexedDB access.
 * - CSP `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'` →
 *   blocks fetch, XMLHttpRequest, WebSocket, image/font loading, etc.
 *
 * Communication is done via postMessage.
 */

import type { ToolDefinition } from "~/types/settings";

const DEFAULT_TIMEOUT_MS = 10_000;

/** Tool definition for Gemini Function Calling */
export const EXECUTE_JAVASCRIPT_TOOL: ToolDefinition = {
  name: "execute_javascript",
  description:
    "Execute JavaScript code in a sandboxed environment and return the result. " +
    "Useful for string manipulation, data transformation, calculations, " +
    "encoding/decoding, compression, and other programmatic operations. " +
    "Available globals: the full ECMAScript standard library (Date, Intl, JSON, Math, RegExp, Map, Set, Promise, etc.) and `utils.randomUUID()` for generating RFC 4122 v4 UUIDs. " +
    "NOT available: `crypto` (use `utils.randomUUID()` instead — `crypto.randomUUID()` / `crypto.subtle` / `require('crypto')` all throw ReferenceError), `fetch`, `XMLHttpRequest`, `setTimeout` beyond completion, DOM, `localStorage`, `process`, `require`. " +
    "Use `return` to return a value. If `input` is provided, it is available as the `input` variable.",
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description:
          "JavaScript code to execute. Use `return` to return a value. " +
          "The variable `input` contains the input data if provided. " +
          "Use `utils.randomUUID()` for UUIDs — `crypto` is NOT defined in this sandbox.",
      },
      input: {
        type: "string",
        description: "Optional input data available as the `input` variable in the code.",
      },
    },
    required: ["code"],
  },
};

// Script nodes run under two different sandboxes (this iframe on the client,
// isolated-vm on the server). To give authors a single stable API, both
// runtimes expose a `utils` object populated with the same helpers. This
// keeps workflow scripts portable and gives us one place to extend as new
// helpers land. Today it carries only `randomUUID()`, implemented via native
// `crypto.randomUUID()` when available and otherwise polyfilled from
// `crypto.getRandomValues()` (which is available in all browser contexts) —
// the isolate-side counterpart lives in isolated-vm-executor.server.ts.
const SANDBOX_HTML = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval';"><script>
(function() {
  function fallbackUuidV4() {
    var b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = [];
    for (var i = 0; i < 16; i++) h.push((b[i] + 0x100).toString(16).slice(1));
    return h[0]+h[1]+h[2]+h[3]+'-'+h[4]+h[5]+'-'+h[6]+h[7]+'-'+h[8]+h[9]+'-'+h[10]+h[11]+h[12]+h[13]+h[14]+h[15];
  }
  window.utils = Object.freeze({
    randomUUID: function() {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
      return fallbackUuidV4();
    },
  });
})();
window.addEventListener('message', async function(event) {
  try {
    var code = event.data.code;
    var input = event.data.input;
    var fn = new Function('input', code);
    var result = fn(input);
    if (result && typeof result.then === 'function') {
      result = await result;
    }
    if (result === undefined || result === null) {
      result = '';
    } else if (typeof result !== 'string') {
      result = JSON.stringify(result);
    }
    parent.postMessage({ type: 'result', value: result }, '*');
  } catch (e) {
    parent.postMessage({ type: 'error', message: e.message || String(e) }, '*');
  }
});
parent.postMessage({ type: 'ready' }, '*');
</` + `script></head><body></body></html>`;

export function executeSandboxedJS(
  code: string,
  input?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.sandbox.add("allow-scripts");
    iframe.style.display = "none";

    let settled = false;

    const cleanup = (timer: ReturnType<typeof setTimeout>) => {
      clearTimeout(timer);
      window.removeEventListener("message", handler);
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    };

    const handler = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "ready" && !settled) {
        iframe.contentWindow!.postMessage({ code, input }, "*");
        return;
      }

      if (data.type === "result" && !settled) {
        settled = true;
        cleanup(timer);
        resolve(typeof data.value === "string" ? data.value : String(data.value ?? ""));
        return;
      }

      if (data.type === "error" && !settled) {
        settled = true;
        cleanup(timer);
        reject(new Error(data.message || "Script execution error"));
      }
    };

    window.addEventListener("message", handler);

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup(timer);
        reject(new Error("Script execution timed out"));
      }
    }, timeoutMs);

    iframe.srcdoc = SANDBOX_HTML;
    document.body.appendChild(iframe);
  });
}
