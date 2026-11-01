import { tr } from "../shared/i18n.ts";
import { z } from "zod";
import { dateJST } from "./domain.ts";

export const genderOptions = [
  { value: "female", get label() { return tr("女性"); } },
  { value: "male", get label() { return tr("男性"); } },
  { value: "other", get label() { return tr("その他"); } },
  { value: "not_specified", get label() { return tr("回答しない"); } },
] as const;
export const customerProfileSchema = z.object({
  name: z.string().trim().min(1, { error: () => tr("お名前を入力してください") }).max(100),
  birthDate: z.iso.date().refine(value => value <= dateJST(), { error: () => tr("生年月日は今日以前の日付を入力してください") }),
  gender: z.enum(["female", "male", "other", "not_specified"]),
});
export type MemberProfile = z.infer<typeof customerProfileSchema>;
export function memberProfile(value: unknown): MemberProfile | null {
  const result = customerProfileSchema.safeParse(value);
  return result.success ? result.data : null;
}
