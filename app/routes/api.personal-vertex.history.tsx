import type { Route } from "./+types/api.personal-vertex.history";
import { requireAuth } from "~/services/session.server";
import { emailToUid } from "~/services/organizations.server";
import { isFirestoreAvailable } from "~/services/firestore.server";
import { getPersonalTopupHistory } from "~/services/ai-budget.server";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await requireAuth(request);
  // Personal balances live in Firestore, which a self-hosted install has
  // no credentials for. Report the feature as unavailable instead of
  // throwing on every settings page load.
  if (!isFirestoreAvailable()) {
    return Response.json({ available: false, events: [] });
  }
  const uid = emailToUid(tokens.email ?? "");
  if (!uid) {
    return Response.json({ error: "No email on session" }, { status: 400 });
  }
  const history = await getPersonalTopupHistory(uid);
  return Response.json({ available: true, events: history });
}
