import ivm from "isolated-vm";

const DEFAULT_TIMEOUT_MS = 10_000;
const MEMORY_LIMIT_MB = 128;

/**
 * Execute JavaScript code in an isolated V8 isolate.
 * Each execution creates a fresh isolate to prevent state leaks.
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

    // Wrap code to capture the result of the last expression
    const wrappedCode = `
      (function() {
        ${code}
      })()
    `;

    const script = await isolate.compileScript(wrappedCode);
    const result = await script.run(context, { timeout: timeoutMs });

    return result != null ? String(result) : "";
  } finally {
    isolate.dispose();
  }
}
