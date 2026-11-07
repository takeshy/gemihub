import React from "react";
import { createRoot } from "react-dom/client";
import { ApiProvider, type ApiClient } from "./api";
import { ThemePreview, PreviewSurface, previewScreens } from "./ScreenGallery";
import { ChromePreview } from "./SiteChrome";
import { sampleFixtures } from "./local-preview";
import { setLocaleResolver } from "../shared/i18n";
import type { VisualPreviewData } from "../shared/visual-review";
import "./style.css";

declare global { interface Window { visualPreviewData?: VisualPreviewData; visualPreviewPending?: number; visualPreviewError?: string } }
// Only the isolated review browser supplies data. This entry has no authenticated API client.
const data = window.visualPreviewData;
if (data) {
  setLocaleResolver(() => data.locale);
  document.documentElement.lang = data.locale;
  // Load below-the-fold managed images too, before taking a full-page capture.
  Object.defineProperty(window, "IntersectionObserver", { value: undefined, configurable: true });
  window.visualPreviewPending = 0;
  const api: ApiClient = async <T,>(path: string): Promise<T> => {
    window.visualPreviewPending!++;
    try {
      const id = new URL(path, location.origin).pathname.split("/").at(-1)!;
      const image = data.images[id];
      if (!image) throw new Error("Review image is unavailable");
      return image as T;
    } finally { window.visualPreviewPending!--; }
  };
  const config = data.config;
  const screen = previewScreens(config).find(screen => screen.id === data.screen);
  const content = data.screen === "initial-theme" || data.screen === "theme"
    ? <ThemePreview config={config} shopId="visual-review" />
    : data.screen === "header" || data.screen === "footer"
      ? <ChromePreview config={config} part={data.screen} imageBase="/review-images" />
      : screen ? <PreviewSurface config={config} shopId="visual-review" screen={{ ...screen, articleKey: data.options.articleKey }} fixtures={data.options.fixtures || sampleFixtures(config)} hideHeader={data.options.hideHeader} hideFooter={data.options.hideFooter} /> : null;
  if (!content) window.visualPreviewError = "The requested screen is unavailable";
  createRoot(document.getElementById("root")!).render(<ApiProvider value={api}><div id="visual-review-surface">{content}</div></ApiProvider>);
}
