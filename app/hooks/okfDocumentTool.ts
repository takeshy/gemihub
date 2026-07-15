import type { ToolDefinition } from "~/types/settings";
import { readOkfDocument } from "~/services/okf-loader";

export function buildOkfDocumentTool(activeOkfBundleIds: string[] | undefined): ToolDefinition[] {
  if (!activeOkfBundleIds || activeOkfBundleIds.length === 0) return [];
  return [{
    name: "read_okf_document",
    description:
      "Fetch the full content of one document from an active OKF knowledge bundle. Use the bundleId shown next to the bundle's heading in the system prompt, and a document path as referenced in that bundle's index (leading slashes are stripped automatically).",
    parameters: {
      type: "object",
      properties: {
        bundleId: {
          type: "string",
          description: "bundleId shown next to the OKF bundle heading in the system prompt",
        },
        path: {
          type: "string",
          description: "Document path referenced in the bundle's index, e.g. features/file-management.md",
        },
      },
      required: ["bundleId", "path"],
    },
  }];
}

export async function executeReadOkfDocumentTool(
  okfRoot: string,
  activeOkfBundleIds: string[] | undefined,
  bundleId: string,
  path: string,
): Promise<Record<string, unknown>> {
  if (!activeOkfBundleIds?.includes(bundleId)) {
    return { error: `OKF bundle is not active: bundleId=${bundleId}` };
  }
  const doc = await readOkfDocument(okfRoot, bundleId, path);
  if (!doc) return { error: `Document not found for bundleId=${bundleId} path=${path}` };
  return { path: doc.path, title: doc.title, description: doc.description, body: doc.body };
}
