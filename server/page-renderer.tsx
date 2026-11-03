import { localizeShell } from "../shared/html.ts";
import { tr } from "../shared/i18n.ts";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomPage } from "../src/CustomPage.tsx";
import type { ShopPage } from "./pages.ts";
import type { ShopConfig } from "./domain.ts";
import { ThemeBody } from "../src/SiteChrome.tsx";
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[c]!);
export function renderCustomPage(page: ShopPage, shell: string, base = "", config?: ShopConfig) {
  const content = <CustomPage page={page} />;
  const body = renderToStaticMarkup(<><nav><a href={`${base}/`}>{tr("お店に戻る")}</a></nav>{config ? <ThemeBody config={config}>{content}</ThemeBody> : content}</>);
  return localizeShell(shell).replace(/<title>.*?<\/title>/s, () => `<title>${escape(page.title)}</title>`).replace('<div id="root"></div>', () => `<div id="root">${body}</div>`);
}
