import { AsyncLocalStorage } from "node:async_hooks";
import type { IncomingMessage } from "node:http";
import { parseLocale, setLocaleResolver, type Locale } from "../shared/i18n.ts";
export const requestLocale = new AsyncLocalStorage<Locale>();
setLocaleResolver(() => requestLocale.getStore() || "ja");
export function localeForRequest(req: IncomingMessage): Locale {
  let query: Locale | undefined;
  try { query = parseLocale(new URL(req.url || "/", "http://localhost").searchParams.get("lang")); } catch { /* The request handler reports malformed URLs. */ }
  const header = parseLocale(req.headers["x-omaiweb-language"]);
  const cookie = parseLocale(req.headers.cookie?.match(/(?:^|;\s*)omaiweb_locale=([^;]*)/)?.[1]);
  return query || header || cookie || "ja";
}
