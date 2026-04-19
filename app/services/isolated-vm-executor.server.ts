import ivm from "isolated-vm";
import { randomUUID } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 10_000;
const MEMORY_LIMIT_MB = 128;

/**
 * Execute JavaScript code in an isolated V8 isolate.
 * Each execution creates a fresh isolate to prevent state leaks.
 *
 * The isolate is a pure V8 — Intl, Date, and the standard ECMAScript library
 * are available out of the box, but Web APIs like `crypto` / `fetch` / DOM
 * are NOT. The runtime exposes a single stable helper namespace, `utils`,
 * shared with the client-side iframe sandbox (sandbox-executor.ts) so the
 * same script code runs in either execution path. Add new helpers by
 * extending both executors together; don't branch on runtime.
 *
 * @param code - JavaScript source code to execute
 * @param input - Optional input string available as `input` variable
 * @param timeoutMs - Execution timeout in milliseconds (default 10s)
 * @returns The result of the last expression, or empty string
 */
export async function executeIsolatedJS(
  code: string,
  input?: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<string> {
  const isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });
  try {
    const context = await isolate.createContext();
    const jail = context.global;

    // Provide input variable
    if (input !== undefined) {
      await jail.set("input", input);
    }

    // Host-side callbacks for the `utils` helper namespace. ivm.Callback
    // copies args and return values via ExternalCopy, so each entry must
    // accept / return primitives (or arrays of primitives). Add a new
    // __hostUtils* callback here and surface it on the `utils` object in
    // the wrapped code below when introducing a new helper.
    await jail.set("__hostUtilsRandomUUID", new ivm.Callback(() => randomUUID()));

    // Wrap code to install the `utils` namespace and normalize the return
    // value. isolated-vm's `script.run()` can only transfer primitives across
    // the isolate boundary — returning a plain object drops silently to
    // `undefined` on the host side, which previously turned every script
    // that did `return { foo: ... }` into an empty-string variable and broke
    // downstream nodes. Serialize inside the isolate so the value the host
    // receives is always a string, matching the client-side iframe sandbox
    // in sandbox-executor.ts where `JSON.stringify` runs on non-strings.
    // `Object.freeze` prevents user code from replacing the helpers (the
    // isolate is fresh per call, but freezing avoids subtle inter-node bugs
    // if shared-state sandboxes ever land).
    const wrappedCode = `
      const utils = Object.freeze({
        randomUUID: function() { return __hostUtilsRandomUUID(); },
      });
      (function() {
        const __out = (function() {
          ${code}
        })();
        if (typeof __out === 'string') return __out;
        if (__out === undefined || __out === null) return '';
        try { return JSON.stringify(__out); } catch (_) { return ''; }
      })()
    `;

    const script = await isolate.compileScript(wrappedCode);
    const result = await script.run(context, { timeout: timeoutMs });

    return result != null ? String(result) : "";
  } finally {
    isolate.dispose();
  }
}
