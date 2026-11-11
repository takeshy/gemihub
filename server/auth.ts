import { tr } from "../shared/i18n.ts";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Store, User } from "./store.ts";
export const origin = () => new URL(process.env.APP_ORIGIN || "http://localhost:3000").origin;
export const demoEnabled = () =>
  process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
/** Every storefront visitor in demo mode books as this one customer, without signing in. */
export const demoCustomerEmail = "customer@example.com";
let demoShoppers = false;
/** Only the server entry turns this on: test harnesses that run in demo mode still check real customer sign-in. */
export function allowDemoShoppers() { demoShoppers = true; }
export const demoShoppersEnabled = () => demoShoppers && demoEnabled();
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
  const id = cookie(req, "gemihub_session");
  if (!id) return;
  const s = await store.get<Session>("session", digest(id));
  if (!s || s.expires < Date.now()) return;
  return s;
}
export async function login(store: Store, res: ServerResponse, user: User, expires = Date.now() + 7 * 86400000) {
  const id = randomBytes(32).toString("base64url");
  await store.put("session", digest(id), { user, expires });
  appendCookie(res, `gemihub_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(0, Math.floor((expires - Date.now()) / 1000))}${origin().startsWith("https:") ? "; Secure" : ""}`);
  return id;
}
/** Adds a Set-Cookie header without replacing cookies already set on this response. */
export function appendCookie(res: ServerResponse, value: string) {
  const current = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [...(Array.isArray(current) ? current : current ? [String(current)] : []), value]);
}
export function equal(a: string, b: string) {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function checkOrigin(req: IncomingMessage) {
  if (req.headers.origin !== origin())
    throw Object.assign(new Error(tr("この操作の送信元を確認できません")), {
      status: 403,
    });
}
