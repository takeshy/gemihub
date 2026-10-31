import { z } from "zod";
import { shopSchema, type ShopConfig } from "./domain.ts";

export const driveMockSchema = z.object({
  shop: shopSchema,
  auth: z.object({ email: z.email(), name: z.string().min(1) }),
  bookings: z.array(z.never()),
  inquiries: z.array(z.never()),
  mode: z.literal("mock"),
  writes: z.literal("discarded"),
});
export type DriveMock = z.infer<typeof driveMockSchema>;
export function driveMock(config: ShopConfig): DriveMock {
  return driveMockSchema.parse({
    shop: config,
    auth: { email: "preview@example.com", name: "プレビューのお客様" },
    bookings: [], inquiries: [], mode: "mock", writes: "discarded",
  });
}

// Keep user strings as JavaScript data, including HTML delimiters and line separators.
export function renderMockScript(mock: DriveMock) {
  const json = JSON.stringify(mock, null, 2).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `window.__OMAIWEB_MOCK__ = ${json};\n`;
}
