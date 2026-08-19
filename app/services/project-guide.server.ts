import type { ProjectAccessContext } from "~/types/enterprise";
import {
  GcsPreconditionFailedError,
  writeObject,
} from "~/services/gcs-storage.server";

import GUIDE_CONTENT from "./project-initial-files/gemihubガイド.md?raw";

export const PROJECT_GUIDE_PATH = "gemihubガイド.md";

/** Create the editable welcome guide once without overwriting user content. */
export async function initializeProjectGuide(ctx: ProjectAccessContext): Promise<void> {
  try {
    await writeObject(ctx, PROJECT_GUIDE_PATH, GUIDE_CONTENT, "text/markdown", {
      ifGenerationMatch: 0,
      createdBy: ctx.uid,
      updatedBy: ctx.uid,
    });
  } catch (error) {
    if (error instanceof GcsPreconditionFailedError) return;
    throw error;
  }
}
