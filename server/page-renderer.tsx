import { localizeShell } from "../shared/html.ts";
import { tr } from "../shared/i18n.ts";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomPage } from "../src/CustomPage.tsx";
import type { ShopPage } from "./pages.ts";
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[c]!);
export function renderCustomPage(page: ShopPage, shell: string, base = "") {
  const body = renderToStaticMarkup(<><nav><a href={`${base}/`}>{tr("お店に戻る")}</a></nav><CustomPage page={page} /></>);
  return localizeShell(shell).replace(/<title>.*?<\/title>/s, () => `<title>${escape(page.title)}</title>`).replace('<div id="root"></div>', () => `<div id="root">${body}</div>`);
}
