import { getLocale } from "./i18n.ts";
// A static export needs a default language even when opened without cookies or storage.
export function localizeShell(shell: string) {
  const locale = getLocale();
  if (locale === "en") shell = shell.replace("omaiweb — お店の言葉で、お店のシステムを。", "omaiweb — Your shop, in your own words.");
  return shell.replace(/<html\b([^>]*)>/i, (_tag, attributes: string) => `<html${attributes.replace(/\s+lang=["'][^"']*["']/i, "")} lang="${locale}">`)
    .replace(/<meta name="omaiweb-language" content="(?:ja|en)">/g, "")
    .replace("</head>", `<meta name="omaiweb-language" content="${locale}"></head>`);
}
