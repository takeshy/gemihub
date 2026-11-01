import { z } from "zod";
import { dateJST } from "./domain.ts";

export const genderOptions = [
  { value: "female", label: "女性" },
  { value: "male", label: "男性" },
  { value: "other", label: "その他" },
  { value: "not_specified", label: "回答しない" },
] as const;
export const customerProfileSchema = z.object({
  name: z.string().trim().min(1, "お名前を入力してください").max(100),
  birthDate: z.iso.date().refine(value => value <= dateJST(), "生年月日は今日以前の日付を入力してください"),
  gender: z.enum(["female", "male", "other", "not_specified"]),
});
export type MemberProfile = z.infer<typeof customerProfileSchema>;
export function memberProfile(value: unknown): MemberProfile | null {
  const result = customerProfileSchema.safeParse(value);
  return result.success ? result.data : null;
}
