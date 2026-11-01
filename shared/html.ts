import { serviceTitles } from "./brand.ts";
import { getLocale } from "./i18n.ts";
// A static export needs a default language even when opened without cookies or storage.
export function localizeShell(shell: string) {
  const locale = getLocale();
  shell = shell.replace(`<title>${serviceTitles.ja}</title>`, `<title>${serviceTitles[locale]}</title>`)
    .replace(`<title>${serviceTitles.en}</title>`, `<title>${serviceTitles[locale]}</title>`);
  return shell.replace(/<html\b([^>]*)>/i, (_tag, attributes: string) => `<html${attributes.replace(/\s+lang=["'][^"']*["']/i, "")} lang="${locale}">`)
    .replace(/<meta name="gemihub-language" content="(?:ja|en)">/g, "")
    .replace("</head>", `<meta name="gemihub-language" content="${locale}"></head>`);
}
