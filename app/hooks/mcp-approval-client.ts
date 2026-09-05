export function requestMcpDecision(server: string, tool: string, args: Record<string, unknown>, canRemember: boolean, signal?: AbortSignal): Promise<"once" | "always" | "deny"> {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog"); dialog.className = "mcp-approval-dialog";
    const title = document.createElement("h2"); title.textContent = "Approve MCP tool call / MCP実行の承認";
    const label = document.createElement("p"); label.textContent = `${server} / ${tool}`;
    const pre = document.createElement("pre"); pre.textContent = JSON.stringify(args, null, 2);
    dialog.append(title, label, pre);
    const onAbort = () => finish("deny");
    const finish = (value: "once" | "always" | "deny") => { signal?.removeEventListener("abort", onAbort); dialog.remove(); resolve(value); };
    if (signal?.aborted) { finish("deny"); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    for (const [value, text] of [["deny", "Deny / 拒否"], ["once", "Allow once / 今回だけ許可"], ...(canRemember ? [["always", "Always allow this tool / 常に許可"]] : [])] as ["once" | "always" | "deny", string][]) {
      const button = document.createElement("button"); button.textContent = text; button.onclick = () => finish(value); dialog.append(button);
    }
    dialog.oncancel = () => finish("deny"); dialog.onclose = () => finish("deny");
    dialog.onclick = event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) finish("deny"); } };
    document.body.append(dialog); dialog.showModal();
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
