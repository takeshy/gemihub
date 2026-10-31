import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomPage } from "../src/CustomPage.tsx";
import type { ShopPage } from "./pages.ts";
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[c]!);
export function renderCustomPage(page: ShopPage, shell: string, base = "") {
  const body = renderToStaticMarkup(<><nav><a href={`${base}/`}>お店に戻る</a></nav><CustomPage page={page} /></>);
  return shell.replace(/<title>.*?<\/title>/s, () => `<title>${escape(page.title)}</title>`).replace('<div id="root"></div>', () => `<div id="root">${body}</div>`);
}
