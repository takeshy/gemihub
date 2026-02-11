import type { ActionFunctionArgs } from "react-router";
import { requireAuth } from "~/services/session.server";
import { getExecution, stopExecution } from "~/services/execution-store.server";

export async function action({ request, params }: ActionFunctionArgs) {
  await requireAuth(request);

  const body = await request.json().catch(() => ({}));
  const executionId = typeof body?.executionId === "string"
    ? body.executionId
    : "";

  if (!executionId) {
    return Response.json({ error: "Missing executionId" }, { status: 400 });
  }

  const execution = getExecution(executionId);
  if (!execution || execution.workflowId !== params.id) {
    return Response.json({ error: "Execution not found" }, { status: 404 });
  }

  stopExecution(executionId);
  return Response.json({ ok: true });
}
