import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage } from "node:http";
import { parseLocale, setLocaleResolver, type Locale } from "../shared/i18n.ts";
import { regionForBrowser } from "../shared/region.ts";
export const requestLocale = new AsyncLocalStorage<Locale>();
setLocaleResolver(() => requestLocale.getStore() || "ja");
export function localeForRequest(req: IncomingMessage): Locale {
  let query: Locale | undefined;
  try { query = parseLocale(new URL(req.url || "/", "http://localhost").searchParams.get("lang")); } catch { /* The request handler reports malformed URLs. */ }
  const header = parseLocale(req.headers["x-gemihub-language"]);
  const cookie = parseLocale(req.headers.cookie?.match(/(?:^|;\s*)gemihub_locale=([^;]*)/)?.[1]);
  return query || header || cookie || browserLocale(req.headers["accept-language"]);
}
/** First visit: a browser that prefers Japanese gets Japanese, any other stated language English. */
export function browserLocale(acceptLanguage: string | undefined): Locale {
  const first = (acceptLanguage || "").split(",")[0]?.trim().split(";")[0] || "";
  if (!first || first === "*") return "ja";
  return /^ja\b/i.test(first) ? "ja" : "en";
}
/** A new shop's region from the first visit: the browser language and its time zone cookie. */
export function regionForRequest(req: IncomingMessage) {
  const zone = req.headers.cookie?.match(/(?:^|;\s*)gemihub_tz=([^;]*)/)?.[1];
  let timeZone: string | undefined;
  try { timeZone = zone ? decodeURIComponent(zone) : undefined; } catch { /* Ignore a malformed cookie. */ }
  return regionForBrowser(browserLocale(req.headers["accept-language"]), timeZone);
}
