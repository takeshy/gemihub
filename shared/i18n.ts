import english from "./en.json";
export const locales = ["ja", "en"] as const;
export type Locale = typeof locales[number];
const messages: Readonly<Record<string, string>> = english;
let localeResolver: (() => Locale) | undefined;
// The server installs an AsyncLocalStorage resolver. No Node APIs enter the web bundle.
export function setLocaleResolver(resolve: () => Locale) { localeResolver = resolve; }
export function parseLocale(value: unknown): Locale | undefined {
  return typeof value === "string" && /^(ja|en)(?:[-_][a-z]+)?$/i.test(value) ? value.slice(0, 2).toLowerCase() as Locale : undefined;
}
export function getLocale(): Locale {
  if (localeResolver) return localeResolver();
  if (typeof window === "undefined") return "ja";
  const query = parseLocale(new URLSearchParams(window.location.search).get("lang"));
  if (query) return query;
  try { const saved = parseLocale(window.localStorage.getItem("gemihub:locale")); if (saved) return saved; } catch { /* Private/offline browsing can deny storage. */ }
  try { const cookie = parseLocale(document.cookie.match(/(?:^|;\s*)gemihub_locale=([^;]*)/)?.[1]); if (cookie) return cookie; } catch { /* Cookie access may be denied. */ }
  return parseLocale(document.querySelector('meta[name="gemihub-language"]')?.getAttribute("content")) || "ja";
}
export const intlLocale = () => getLocale() === "en" ? "en-US" : "ja-JP";
// Source-language keys preserve Japanese copy and make untranslated additions visible in review.
export function translate(locale: Locale, source: string, ...values: unknown[]): string {
  const text = locale === "en" ? messages[source] ?? source : source;
  return text.replace(/\{(\d+)\}/g, (match, index: string) => Number(index) < values.length ? String(values[Number(index)]) : match);
}
export const tr = (source: string, ...values: unknown[]) => translate(getLocale(), source, ...values);

export function rememberLocale(locale: Locale) {
  try { localStorage.setItem("gemihub:locale", locale); } catch { /* URL remains available. */ }
  if (location.protocol === "file:") return;
  try { document.cookie = `gemihub_locale=${locale}; Path=/; SameSite=Lax; Max-Age=31536000${location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* Cookie storage may be blocked. */ }
}
