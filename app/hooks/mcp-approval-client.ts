import { t } from "~/i18n/translations";

type McpDecision = "once" | "always" | "deny";

export function requestMcpDecision(server: string, tool: string, args: Record<string, unknown>, canRemember: boolean, signal?: AbortSignal): Promise<McpDecision> {
  return new Promise(resolve => {
    const language = document.documentElement.lang.startsWith("ja") ? "ja" : "en";
    const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
      const node = document.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const dialog = element("dialog", "mcp-approval-dialog");
    const titleId = `mcp-approval-${crypto.randomUUID()}`;
    dialog.setAttribute("aria-labelledby", titleId);
    dialog.setAttribute("aria-describedby", `${titleId}-description`);

    const header = element("div", "mcp-approval-header");
    const heading = element("div", "mcp-approval-heading");
    const badge = element("span", "mcp-approval-badge", "MCP");
    const title = element("h2", "mcp-approval-title", t(language, "mcpApproval.title"));
    title.id = titleId;
    heading.append(badge, title);
    const close = element("button", "mcp-approval-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", t(language, "common.close"));
    header.append(heading, close);

    const body = element("div", "mcp-approval-body");
    const description = element("p", "mcp-approval-description", t(language, "mcpApproval.description"));
    description.id = `${titleId}-description`;
    const info = element("dl", "mcp-approval-info");
    for (const [label, value] of [[t(language, "mcpApproval.server"), server], [t(language, "mcpApproval.tool"), tool]]) {
      const row = element("div", "mcp-approval-info-row");
      row.append(element("dt", "mcp-approval-label", label), element("dd", "mcp-approval-value", value));
      info.append(row);
    }
    const details = element("details", "mcp-approval-details");
    details.open = true;
    details.append(
      element("summary", "mcp-approval-summary", t(language, "mcpApproval.arguments")),
      element("pre", "mcp-approval-arguments", JSON.stringify(args, null, 2)),
    );
    body.append(description, info, details);
    if (canRemember) body.append(element("p", "mcp-approval-hint", t(language, "mcpApproval.rememberHint")));

    let finished = false;
    const previouslyFocused = document.activeElement;
    const onAbort = () => finish("deny");
    const finish = (value: McpDecision) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", onAbort);
      if (dialog.open) dialog.close();
      dialog.remove();
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus({ preventScroll: true });
      resolve(value);
    };
    if (signal?.aborted) { finish("deny"); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    close.onclick = () => finish("deny");

    const footer = element("div", "mcp-approval-footer");
    const choices: [McpDecision, string][] = [
      ["deny", t(language, "mcpApproval.deny")],
      ...(canRemember ? [["always", t(language, "mcpApproval.always")] as [McpDecision, string]] : []),
      ["once", t(language, "mcpApproval.once")],
    ];
    for (const [value, label] of choices) {
      const button = element("button", `mcp-approval-button mcp-approval-button-${value}`, label);
      button.type = "button";
      // Opening the dialog must not make Enter approve an unseen request.
      if (value === "deny") button.autofocus = true;
      button.onclick = () => finish(value);
      footer.append(button);
    }
    dialog.append(header, body, footer);
    dialog.oncancel = event => { event.preventDefault(); finish("deny"); };
    dialog.onclose = () => finish("deny");
    dialog.onclick = event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) finish("deny");
    };
    document.body.append(dialog);
    dialog.showModal();
  });
}

let queue: Promise<unknown> = Promise.resolve();
function decision(server: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal) {
  const run = () => signal?.aborted ? Promise.resolve("deny" as const) : requestMcpDecision(server, tool, args, true, signal);
  const result = queue.then(run); queue = result.catch(() => {}); return result;
}
export async function answerMcpApproval(approval: { id: string; server: string; tool: string; args: Record<string, unknown> }, signal?: AbortSignal) {
  const choice = await decision(approval.server, approval.tool, approval.args, signal);
  const response = await fetch("/api/mcp/approval", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: approval.id, decision: choice }), signal });
  if (!response.ok) throw new Error("MCP approval expired or was rejected");
}
export async function fetchWithMcpApproval(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status !== 428) return response;
  const { mcpApproval } = await response.json() as { mcpApproval: { server: string; tool: string; args: Record<string, unknown> } };
  const choice = await decision(mcpApproval.server, mcpApproval.tool, mcpApproval.args, init.signal ?? undefined);
  if (choice === "deny") throw new Error(`MCP tool call denied: ${mcpApproval.tool}`);
  const body = JSON.parse(String(init.body));
  return fetch(url, { ...init, body: JSON.stringify({ ...body, mcpApprovalDecision: choice, mcpApprovedCall: mcpApproval }) });
}
