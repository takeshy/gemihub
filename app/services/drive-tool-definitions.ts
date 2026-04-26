// Drive tool definitions for Gemini Function Calling (browser-safe)

import type { ToolDefinition } from "~/types/settings";

/**
 * Set of drive tool names that are search/list related.
 * Used for filtering when driveToolMode === "noSearch".
 */
export const DRIVE_SEARCH_TOOL_NAMES = new Set([
  "search_drive_files",
  "list_drive_files",
]);


/**
 * Drive tool definitions for Gemini Function Calling
 */
export const DRIVE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "read_drive_file",
    description: "Read the content of a file from Google Drive by its file ID",
    parameters: {
      type: "object",
      properties: {
        fileId: {
          type: "string",
          description: "The Google Drive file ID",
        },
      },
      required: ["fileId"],
    },
  },
  {
    name: "search_drive_files",
    description: "Search for files in Google Drive by name or content",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
        searchContent: {
          type: "boolean",
          description: "Whether to search file content (true) or just names (false). Default: false",
        },
        folder: {
          type: "string",
          description: "Virtual folder path to filter results (e.g. 'notes' or 'projects/src'). If omitted, searches all files",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_drive_files",
    description: "List files in Google Drive. Files are organized in a virtual folder structure using path separators in file names (e.g. 'notes/todo.md'). Use the folder parameter to list files under a specific path.",
    parameters: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "Virtual folder path to list (e.g. 'notes' or 'projects/src'). If omitted, lists all files and top-level virtual folders",
        },
      },
    },
  },
  {
    name: "create_drive_file",
    description: "Create a NEW file in Google Drive at a path that does not yet exist. Specify the full path including folder (e.g. 'web/index.html', 'notes/memo.md', 'temporaries/draft.md'). This call FAILS with an error if a file already exists at the path — to edit an existing file, call update_drive_file with its fileId instead. Use list_drive_files / search_drive_files first if you are not sure whether the path is taken.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The file path (e.g. 'web/about.html', 'temporaries/report.md')",
        },
        content: {
          type: "string",
          description: "The file content",
        },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "update_drive_file",
    description: "Replace the content of an existing file in Google Drive. The file must already exist; locate its fileId via list_drive_files or search_drive_files first. For new paths, call create_drive_file instead.",
    parameters: {
      type: "object",
      properties: {
        fileId: {
          type: "string",
          description: "The Google Drive file ID",
        },
        content: {
          type: "string",
          description: "The new file content",
        },
      },
      required: ["fileId", "content"],
    },
  },
  {
    name: "rename_drive_file",
    description: "Rename a file in Google Drive",
    parameters: {
      type: "object",
      properties: {
        fileId: {
          type: "string",
          description: "The Google Drive file ID",
        },
        newName: {
          type: "string",
          description: "The new file name (including path, e.g. 'notes/renamed.md')",
        },
      },
      required: ["fileId", "newName"],
    },
  },
  {
    name: "bulk_rename_drive_files",
    description: "Rename multiple files in Google Drive in a single operation",
    parameters: {
      type: "object",
      properties: {
        files: {
          type: "array",
          description: "Array of files to rename",
          items: {
            type: "object",
            properties: {
              fileId: {
                type: "string",
                description: "The Google Drive file ID",
              },
              newName: {
                type: "string",
                description: "The new file name (including path)",
              },
            },
            required: ["fileId", "newName"],
          },
        },
      },
      required: ["files"],
    },
  },
];
