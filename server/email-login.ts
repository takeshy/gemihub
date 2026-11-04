import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getLocale, tr } from "../shared/i18n.ts";
import { digest } from "./auth.ts";
import { memberProfile } from "./customer-profile.ts";
import type { Shop, Store, User } from "./store.ts";

export type LoginMailer = (shop: Shop, to: string, subject: string, text: string) => Promise<void>;
type Challenge = { shopId: string; email: string; origin: string; expires: number };
type Limit = { count: number; last: number; expires: number };
const emailSchema = z.string().trim().max(254).pipe(z.email()).transform(email => email.toLowerCase());
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const invalid = () => Object.assign(new Error(tr("認証リンクが無効か、有効期限が切れています。もう一度メールを送ってください。")), { status: 400 });
const lifetime = 15 * 60000;

export function emailLogin(store: Store, send: LoginMailer) {
  async function limit(key: string, maximum: number, cooldown = 0) {
    await store.locked(`email-login-limit:${key}`, async () => {
      const now = Date.now();
      const previous = await store.get<Limit>("emailLoginLimit", key);
      const value = previous && previous.expires > now ? previous : { count: 0, last: 0, expires: now + lifetime };
      if (value.count >= maximum || value.last && now - value.last < cooldown)
        throw Object.assign(new Error(tr("少し時間をおいてから、もう一度メールを送ってください。")), { status: 429 });
      await store.put("emailLoginLimit", key, { ...value, count: value.count + 1, last: now });
    });
  }
  async function challenge(shop: Shop, requestOrigin: string, input: unknown) {
    const parsed = z.object({ token: tokenSchema }).safeParse(input);
    if (!parsed.success) throw invalid();
    const { token } = parsed.data;
    const value = await store.get<Challenge>("emailLogin", digest(token));
    if (!value || value.shopId !== shop.id || value.origin !== requestOrigin || value.expires <= Date.now()) throw invalid();
    return { token, value };
  }
  return {
    async request(shop: Shop, requestOrigin: string, storefrontPath: string, ip: string, input: unknown) {
      const { email } = z.object({ email: emailSchema }).parse(input);
      await limit(`ip:${digest(ip)}`, 20);
      await limit(`email:${digest(`${shop.id}:${email}`)}`, 3, 60000);
      const token = randomBytes(32).toString("base64url");
      const key = digest(token);
      await store.put("emailLogin", key, { shopId: shop.id, email, origin: requestOrigin, expires: Date.now() + lifetime } satisfies Challenge);
      // Fragments stay out of HTTP requests, access logs, and referrer headers.
      const link = new URL(storefrontPath, requestOrigin);
      link.searchParams.set("pane", "mine");
      link.searchParams.set("lang", getLocale());
      link.hash = new URLSearchParams({ "email-login": token }).toString();
      try {
        await send(shop, email, tr("{0} のメール認証", shop.published!.name), tr("次のリンクを開いて、メールアドレスを確認してください。\n\n{0}\n\nリンクは15分間有効で、1回だけ使えます。心当たりがない場合は、このメールを無視してください。", link.href));
      } catch {
        await store.delete("emailLogin", key);
        throw Object.assign(new Error(tr("認証メールを送信できませんでした。しばらくしてから、もう一度お試しください。")), { status: 503 });
      }
    },
    async info(shop: Shop, requestOrigin: string, input: unknown) {
      const { value } = await challenge(shop, requestOrigin, input);
      return { email: value.email, shopName: shop.published!.name };
    },
    async verify(shop: Shop, requestOrigin: string, input: unknown): Promise<User> {
      const { token, value } = await challenge(shop, requestOrigin, input);
      // Reading the link does not consume it; only the explicit confirmation does.
      const consumed = await store.take<Challenge>("emailLogin", digest(token));
      if (!consumed || consumed.expires <= Date.now()) throw invalid();
      const profile = memberProfile(await store.get("customer", `${shop.id}:${value.email}`));
      return { email: value.email, name: profile?.name || "", role: "customer", shopId: shop.id, authMethod: "email" };
    },
  };
}
