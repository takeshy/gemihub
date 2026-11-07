import type { Fixtures } from "../src/local-preview";
import type { ShopConfig } from "../server/domain";
import type { Locale } from "./i18n";

export type VisualPreviewOptions = {
  fixtures?: Fixtures;
  hideHeader?: boolean;
  hideFooter?: boolean;
  articleKey?: string;
};
export type VisualPreviewData = {
  config: ShopConfig;
  screen: string;
  locale: Locale;
  options: VisualPreviewOptions;
  images: Record<string, { mimeType: string; data: string }>;
};
export type VisualReview = { approved: boolean; issues: string[] };
