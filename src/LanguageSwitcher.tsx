import React from "react";
import { getLocale, rememberLocale, type Locale } from "../shared/i18n";
/** Static pages switch languages with ordinary links and do not require JavaScript. */
export function LanguageLinks({ href }: { href: string }) {
  const locale = getLocale();
  return <nav className="language-switcher" aria-label="Language / 言語">
    <a href={`${href || "/"}?lang=ja`} lang="ja" aria-current={locale === "ja" ? "true" : undefined}>日本語</a>
    <a href={`${href || "/"}?lang=en`} lang="en" aria-current={locale === "en" ? "true" : undefined}>English</a>
  </nav>;
}
export function LanguageSwitcher() {
  const locale = getLocale();
  function change(next: Locale) {
    rememberLocale(next);
    const url = new URL(location.href); url.searchParams.set("lang", next);
    location.assign(url.href);
  }
  return <nav className="language-switcher" aria-label="Language / 言語">
    <button type="button" lang="ja" aria-current={locale === "ja" ? "true" : undefined} disabled={locale === "ja"} onClick={() => change("ja")}>日本語</button>
    <button type="button" lang="en" aria-current={locale === "en" ? "true" : undefined} disabled={locale === "en"} onClick={() => change("en")}>English</button>
  </nav>;
}
