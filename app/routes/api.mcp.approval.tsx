import { requireAuth } from "~/services/session.server";
import { approvalOwner, decideMcpApproval } from "~/services/mcp-approval.server";
export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const tokens = await requireAuth(request);
  const { id, decision } = await request.json() as { id: string; decision: string };
  const accepted = await decideMcpApproval(id, approvalOwner(tokens), decision);
  return Response.json({ accepted }, { status: accepted ? 200 : 403 });
}
