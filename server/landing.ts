import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { LandingPage, landingDescription, landingTitle } from "../src/LandingPage.tsx";
import { productionOrigin } from "../shared/brand.ts";
import { getLocale } from "../shared/i18n.ts";
import { localizeShell } from "../shared/html.ts";
import { escapeHtml } from "./artifacts.ts";

export function renderLanding(shell: string) {
  const title = escapeHtml(landingTitle());
  const description = escapeHtml(landingDescription());
  const canonical = `${productionOrigin}/lp${getLocale() === "en" ? "?lang=en" : ""}`;
  const meta = `<meta name="description" content="${description}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonical}"><link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="ja" href="${productionOrigin}/lp"><link rel="alternate" hreflang="en" href="${productionOrigin}/lp?lang=en"><link rel="alternate" hreflang="x-default" href="${productionOrigin}/lp">`;
  return localizeShell(shell)
    .replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
    .replace("</head>", () => `${meta}</head>`)
    .replace('<div id="root"></div>', () => `<div id="root" data-page="lp">${renderToString(createElement(LandingPage))}</div>`);
}
