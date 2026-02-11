import type { Route } from "./+types/api.prompt-response";
import { requireAuth } from "~/services/session.server";
import { isExecutionOwnedBy, resolvePrompt } from "~/services/execution-store.server";

export async function action({ request }: Route.ActionArgs) {
  const tokens = await requireAuth(request);

  const body = await request.json();
  const { executionId, value } = body;

  if (!executionId) {
    return Response.json({ error: "Missing executionId" }, { status: 400 });
  }
  if (!isExecutionOwnedBy(executionId, tokens.rootFolderId)) {
    return Response.json({ error: "Execution not found" }, { status: 404 });
  }

  resolvePrompt(executionId, value);

  return Response.json({ ok: true });
}
