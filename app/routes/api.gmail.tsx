import type { Route } from "./+types/api.gmail";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { google } from "googleapis";
import { validateEmailHeader } from "~/utils/security";

/**
 * POST /api/gmail — Gmail operations for plugins.
 * Body: { action: "send", to, subject, body, cc?, bcc? }
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const sessionTokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, sessionTokens);

  const payload = await request.json();
  const gmailAction = payload.action as string;

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: validTokens.accessToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  try {
    switch (gmailAction) {
      case "send": {
        const to = payload.to as string;
        const subject = payload.subject as string;
        const body = payload.body as string;
        const cc = payload.cc as string | undefined;
        const bcc = payload.bcc as string | undefined;

        if (!to) return Response.json({ error: "'to' is required" }, { status: 400 });
        if (!subject) return Response.json({ error: "'subject' is required" }, { status: 400 });

        validateEmailHeader(to, "to");
        validateEmailHeader(subject, "subject");
        if (cc) validateEmailHeader(cc, "cc");
        if (bcc) validateEmailHeader(bcc, "bcc");

        const messageParts = [
          `To: ${to}`,
          ...(cc ? [`Cc: ${cc}`] : []),
          ...(bcc ? [`Bcc: ${bcc}`] : []),
          `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
          "MIME-Version: 1.0",
          "Content-Type: text/html; charset=\"UTF-8\"",
          "Content-Transfer-Encoding: base64",
          "",
          Buffer.from(body || "").toString("base64"),
        ];
        const rawMessage = messageParts.join("\r\n");
        const encodedMessage = Buffer.from(rawMessage)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        const res = await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw: encodedMessage },
        });

        return Response.json({ messageId: res.data.id });
      }

      default:
        return Response.json({ error: `Unknown action: ${gmailAction}` }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Gmail operation failed";
    const status = (e as { code?: number })?.code === 403 ? 403 : 500;
    return Response.json({ error: message }, { status });
  }
}
