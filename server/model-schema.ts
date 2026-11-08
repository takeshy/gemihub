import type { z } from "zod";

/** Keep array limits in application validation; large bounded arrays exceed Vertex's grammar budget. */
export function modelJsonSchema(schema: z.ZodType) {
  return schema.toJSONSchema({
    override({ jsonSchema }) {
      if (jsonSchema.type !== "array") return;
      const limits = [
        jsonSchema.minItems === undefined ? "" : `At least ${jsonSchema.minItems} items.`,
        jsonSchema.maxItems === undefined ? "" : `At most ${jsonSchema.maxItems} items.`,
      ].filter(Boolean);
      if (limits.length) jsonSchema.description = [jsonSchema.description, ...limits].filter(Boolean).join(" ");
      delete jsonSchema.minItems;
      delete jsonSchema.maxItems;
    },
  });
}
