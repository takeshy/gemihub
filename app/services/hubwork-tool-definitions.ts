// Hubwork tool definitions for Gemini Function Calling (browser-safe)

import type { ToolDefinition } from "~/types/settings";

export const HUBWORK_TOOL_NAME = "get_spreadsheet_schema";

export const HUBWORK_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: HUBWORK_TOOL_NAME,
    description:
      "Get the schema (sheet tab names and column headers) of a configured Google Spreadsheet. " +
      "Use this to understand the data structure before building workflows that read/write sheets, " +
      "or before configuring authentication account types. " +
      "If spreadsheetId is omitted, returns schema for the first configured spreadsheet.",
    parameters: {
      type: "object",
      properties: {
        spreadsheetId: {
          type: "string",
          description: "The Google Spreadsheet ID. Optional — defaults to the first configured spreadsheet.",
        },
      },
    },
  },
  {
    name: "calendar_list_events",
    description:
      "List events from Google Calendar. Returns events within a time range. " +
      "Dates must be in ISO 8601 format (e.g. 2025-03-28T00:00:00+09:00). " +
      "Use this to check the user's schedule or find specific events.",
    parameters: {
      type: "object",
      properties: {
        calendarId: {
          type: "string",
          description: "Calendar ID. Defaults to 'primary' (user's main calendar).",
        },
        timeMin: {
          type: "string",
          description: "Start of time range (ISO 8601). Example: 2025-03-28T00:00:00+09:00",
        },
        timeMax: {
          type: "string",
          description: "End of time range (ISO 8601). Example: 2025-03-31T23:59:59+09:00",
        },
        maxResults: {
          type: "number",
          description: "Maximum number of events to return. Default: 50, max: 250.",
        },
        query: {
          type: "string",
          description: "Free text search query to filter events.",
        },
      },
    },
  },
  {
    name: "calendar_create_event",
    description:
      "Create a new event on Google Calendar. " +
      "For timed events, use ISO 8601 dateTime (e.g. 2025-03-28T10:00:00+09:00). " +
      "For all-day events, use date format (e.g. 2025-03-28).",
    parameters: {
      type: "object",
      properties: {
        calendarId: {
          type: "string",
          description: "Calendar ID. Defaults to 'primary'.",
        },
        summary: {
          type: "string",
          description: "Event title.",
        },
        description: {
          type: "string",
          description: "Event description.",
        },
        start: {
          type: "string",
          description: "Start time (ISO 8601 dateTime) or date (YYYY-MM-DD for all-day).",
        },
        end: {
          type: "string",
          description: "End time (ISO 8601 dateTime) or date (YYYY-MM-DD for all-day).",
        },
        location: {
          type: "string",
          description: "Event location.",
        },
      },
      required: ["summary", "start", "end"],
    },
  },
  {
    name: "calendar_update_event",
    description: "Update an existing Google Calendar event. Only specified fields are updated.",
    parameters: {
      type: "object",
      properties: {
        calendarId: {
          type: "string",
          description: "Calendar ID. Defaults to 'primary'.",
        },
        eventId: {
          type: "string",
          description: "The event ID to update.",
        },
        summary: { type: "string", description: "New event title." },
        description: { type: "string", description: "New event description." },
        start: { type: "string", description: "New start time (ISO 8601) or date." },
        end: { type: "string", description: "New end time (ISO 8601) or date." },
        location: { type: "string", description: "New event location." },
      },
      required: ["eventId"],
    },
  },
  {
    name: "calendar_delete_event",
    description: "Delete an event from Google Calendar.",
    parameters: {
      type: "object",
      properties: {
        calendarId: {
          type: "string",
          description: "Calendar ID. Defaults to 'primary'.",
        },
        eventId: {
          type: "string",
          description: "The event ID to delete.",
        },
      },
      required: ["eventId"],
    },
  },
];

export const MIGRATE_TOOL_NAME = "migrate_spreadsheet_schema";

export const HUBWORK_TOOL_DEFINITIONS_EXTRA: ToolDefinition[] = [
  {
    name: MIGRATE_TOOL_NAME,
    description:
      "Apply a schema definition to the spreadsheet — creates missing sheets and appends missing columns. " +
      "Pass the full content of web/__gemihub/schema.md as the schema parameter. " +
      "Read the file with read_drive_file first, then call this tool with the content.",
    parameters: {
      type: "object",
      properties: {
        schema: {
          type: "string",
          description: "The full content of schema.md (markdown with ## sheet_name and - column_name format).",
        },
      },
      required: ["schema"],
    },
  },
];

export const CALENDAR_TOOL_NAMES = new Set([
  "calendar_list_events",
  "calendar_create_event",
  "calendar_update_event",
  "calendar_delete_event",
]);
