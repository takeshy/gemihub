import type { Route } from "./+types/api.calendar";
import { requireAuth } from "~/services/session.server";
import { getValidTokens } from "~/services/google-auth.server";
import { google } from "googleapis";

/**
 * POST /api/calendar — Execute calendar tool calls from the Interactions API chat client.
 * Body: { action: "list"|"create"|"update"|"delete", ...params }
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const sessionTokens = await requireAuth(request);
  const { tokens: validTokens } = await getValidTokens(request, sessionTokens);

  const body = await request.json();
  const calendarAction = body.action as string;

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: validTokens.accessToken });
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  try {
    switch (calendarAction) {
      case "list": {
        const calendarId = body.calendarId || "primary";
        const res = await calendar.events.list({
          calendarId,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: Math.min(body.maxResults || 50, 250),
          timeMin: body.timeMin || undefined,
          timeMax: body.timeMax || undefined,
          q: body.query || undefined,
        });
        const events = (res.data.items || []).map((ev) => ({
          id: ev.id,
          summary: ev.summary,
          description: ev.description,
          start: ev.start?.dateTime || ev.start?.date,
          end: ev.end?.dateTime || ev.end?.date,
          location: ev.location,
          status: ev.status,
          htmlLink: ev.htmlLink,
        }));
        return Response.json({ events });
      }

      case "create": {
        const calendarId = body.calendarId || "primary";
        const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(body.start || "");
        const eventBody: Record<string, unknown> = {
          summary: body.summary,
          start: isAllDay ? { date: body.start } : { dateTime: body.start },
          end: isAllDay ? { date: body.end } : { dateTime: body.end },
        };
        if (body.description) eventBody.description = body.description;
        if (body.location) eventBody.location = body.location;

        const res = await calendar.events.insert({ calendarId, requestBody: eventBody });
        return Response.json({ eventId: res.data.id, htmlLink: res.data.htmlLink });
      }

      case "update": {
        const calendarId = body.calendarId || "primary";
        const patch: Record<string, unknown> = {};
        if (body.summary) patch.summary = body.summary;
        if (body.description) patch.description = body.description;
        if (body.location) patch.location = body.location;
        if (body.start) {
          const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(body.start);
          patch.start = isAllDay ? { date: body.start } : { dateTime: body.start };
        }
        if (body.end) {
          const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(body.end);
          patch.end = isAllDay ? { date: body.end } : { dateTime: body.end };
        }

        const res = await calendar.events.patch({
          calendarId,
          eventId: body.eventId,
          requestBody: patch,
        });
        return Response.json({ eventId: res.data.id, htmlLink: res.data.htmlLink });
      }

      case "delete": {
        const calendarId = body.calendarId || "primary";
        await calendar.events.delete({ calendarId, eventId: body.eventId });
        return Response.json({ deleted: true });
      }

      default:
        return Response.json({ error: `Unknown action: ${calendarAction}` }, { status: 400 });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Calendar operation failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
