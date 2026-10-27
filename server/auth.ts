import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Store, User } from "./store.ts";
export const origin = () => process.env.APP_ORIGIN || "http://localhost:3000";
export const demoEnabled = () =>
  process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
export type Session = {
  user: User;
  expires: number;
};
export function cookie(req: IncomingMessage, name: string) {
  return (req.headers.cookie || "")
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function session(store: Store, req: IncomingMessage) {
  const id = cookie(req, "omai_session");
  if (!id) return;
  const s = await store.get<Session>("session", digest(id));
  if (!s || s.expires < Date.now()) return;
  return s;
}
export async function login(store: Store, res: ServerResponse, user: User) {
  const id = randomBytes(32).toString("base64url");
  await store.put("session", digest(id), {
    user,
    expires: Date.now() + 7 * 86400000,
  });
  res.setHeader(
    "Set-Cookie",
    `omai_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${origin().startsWith("https:") ? "; Secure" : ""}`,
  );
}
export function equal(a: string, b: string) {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function checkOrigin(req: IncomingMessage) {
  if (req.headers.origin !== origin())
    throw Object.assign(new Error("この操作の送信元を確認できません"), {
      status: 403,
    });
}
