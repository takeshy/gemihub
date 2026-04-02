import type { WorkflowNode, ExecutionContext, ServiceContext } from "../types";
import { replaceVariables } from "./utils";

function requireCalendar(serviceContext: ServiceContext) {
  if (!serviceContext.hubworkCalendarClient) {
    throw new Error("Hubwork Calendar is not configured. Enable Hubwork and grant Calendar permissions.");
  }
  return serviceContext.hubworkCalendarClient;
}

/**
 * calendar-list: List events from Google Calendar.
 * Properties: calendarId?, timeMin?, timeMax?, maxResults?, query?, saveTo
 */
export async function handleCalendarListNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext,
): Promise<void> {
  const calendar = requireCalendar(serviceContext);
  const calendarId = replaceVariables(node.properties["calendarId"] || "primary", context);
  const timeMin = replaceVariables(node.properties["timeMin"] || "", context);
  const timeMax = replaceVariables(node.properties["timeMax"] || "", context);
  const maxResults = parseInt(replaceVariables(node.properties["maxResults"] || "50", context), 10);
  const query = replaceVariables(node.properties["query"] || "", context);
  const saveTo = node.properties["saveTo"];

  const res = await calendar.events.list({
    calendarId,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: Math.min(maxResults || 50, 250),
    timeMin: timeMin || undefined,
    timeMax: timeMax || undefined,
    q: query || undefined,
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

  if (saveTo) {
    context.variables.set(saveTo, JSON.stringify(events));
  }
}

/**
 * calendar-create: Create a new event on Google Calendar.
 * Properties: calendarId?, summary, description?, start, end, location?, saveTo?
 */
export async function handleCalendarCreateNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext,
): Promise<void> {
  const calendar = requireCalendar(serviceContext);
  const calendarId = replaceVariables(node.properties["calendarId"] || "primary", context);
  const summary = replaceVariables(node.properties["summary"] || "", context);
  const description = replaceVariables(node.properties["description"] || "", context);
  const start = replaceVariables(node.properties["start"] || "", context);
  const end = replaceVariables(node.properties["end"] || "", context);
  const location = replaceVariables(node.properties["location"] || "", context);

  if (!summary) throw new Error("calendar-create: 'summary' property is required");
  if (!start) throw new Error("calendar-create: 'start' property is required");
  if (!end) throw new Error("calendar-create: 'end' property is required");

  const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(start);
  const eventBody: Record<string, unknown> = {
    summary,
    start: isAllDay ? { date: start } : { dateTime: start },
    end: isAllDay ? { date: end } : { dateTime: end },
  };
  if (description) eventBody.description = description;
  if (location) eventBody.location = location;

  const res = await calendar.events.insert({
    calendarId,
    requestBody: eventBody,
  });

  const saveTo = node.properties["saveTo"];
  if (saveTo) {
    context.variables.set(saveTo, res.data.id || "created");
  }
}

/**
 * calendar-update: Update an existing event on Google Calendar.
 * Properties: calendarId?, eventId, summary?, description?, start?, end?, location?, saveTo?
 */
export async function handleCalendarUpdateNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext,
): Promise<void> {
  const calendar = requireCalendar(serviceContext);
  const calendarId = replaceVariables(node.properties["calendarId"] || "primary", context);
  const eventId = replaceVariables(node.properties["eventId"] || "", context);

  if (!eventId) throw new Error("calendar-update: 'eventId' property is required");

  const summary = replaceVariables(node.properties["summary"] || "", context);
  const description = replaceVariables(node.properties["description"] || "", context);
  const start = replaceVariables(node.properties["start"] || "", context);
  const end = replaceVariables(node.properties["end"] || "", context);
  const location = replaceVariables(node.properties["location"] || "", context);

  const patch: Record<string, unknown> = {};
  if (summary) patch.summary = summary;
  if (description) patch.description = description;
  if (location) patch.location = location;
  if (start) {
    const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(start);
    patch.start = isAllDay ? { date: start } : { dateTime: start };
  }
  if (end) {
    const isAllDay = /^\d{4}-\d{2}-\d{2}$/.test(end);
    patch.end = isAllDay ? { date: end } : { dateTime: end };
  }

  const res = await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: patch,
  });

  const saveTo = node.properties["saveTo"];
  if (saveTo) {
    context.variables.set(saveTo, res.data.id || "updated");
  }
}

/**
 * calendar-delete: Delete an event from Google Calendar.
 * Properties: calendarId?, eventId
 */
export async function handleCalendarDeleteNode(
  node: WorkflowNode,
  context: ExecutionContext,
  serviceContext: ServiceContext,
): Promise<void> {
  const calendar = requireCalendar(serviceContext);
  const calendarId = replaceVariables(node.properties["calendarId"] || "primary", context);
  const eventId = replaceVariables(node.properties["eventId"] || "", context);

  if (!eventId) throw new Error("calendar-delete: 'eventId' property is required");

  await calendar.events.delete({ calendarId, eventId });
}
