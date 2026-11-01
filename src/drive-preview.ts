import { driveMockSchema } from "../server/drive-mock";

declare global {
  interface Window { __GEMIHUB_MOCK__?: unknown }
}

export function drivePreviewData(protocol: string, value: unknown) {
  if (protocol !== "file:" || value === undefined) return undefined;
  const parsed = driveMockSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
