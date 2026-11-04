import { tr } from "../shared/i18n";
import React, { useEffect, useMemo, useRef } from "react";
import { ApiProvider, useApi } from "./api";
import { ChromePreview } from "./SiteChrome";
import { PublicShop, type Session } from "./App";
import { replaceScope } from "./editor-sync";
import { createPreviewClient, type Fixtures } from "./local-preview";
import type { ShopConfig } from "../server/domain";
import type { ReleaseScope, ShopPage } from "../server/pages";
export function SyncPreview({ config, value, scope, fixtures, shopId }: { config: ShopConfig; value: unknown; scope: ReleaseScope; fixtures: Fixtures; shopId: string }) {
  const api = useApi();
  const previewConfig = useMemo(() => {
    if (value === null) return config;
    if (scope.kind === "page") return replaceScope({ ...config, pages: [] }, scope, value);
    return replaceScope(config, scope, value);
  }, [config, value, JSON.stringify(scope)]);
  const mock = useMemo(() => createPreviewClient(previewConfig, fixtures, shopId, (imageId, view) => api(`/api/shops/${shopId}/menu-images/${imageId}${view ? `?view=${view}` : ""}`)), [previewConfig, fixtures, shopId, api]);
  const session: Session = { demo: false, user: { email: "sample@example.com", name: fixtures.customerName, role: "customer", shopId } };
  const frame = useRef<HTMLDivElement>(null);
  // A page comparison is about the page body: once the preview has rendered, scroll the frame to it.
  useEffect(() => {
    if (scope.kind !== "page" || value === null) return;
    let attempts = 0, timer = 0;
    const find = () => {
      const page = frame.current?.querySelector<HTMLElement>(".custom-page");
      if (page && frame.current) frame.current.scrollTop = page.offsetTop - frame.current.offsetTop - 8;
      else if (++attempts < 40) timer = window.setTimeout(find, 50);
    };
    find();
    return () => window.clearTimeout(timer);
  }, [JSON.stringify(value), scope.kind]);
  if (value === null) return <p className="notice">{tr("この側では")}{scope.kind === "page" ? tr("ページが削除されています（または未作成）") : tr("お店が未公開です")}。</p>;
  // The frame scrolls; only its content is inert (read-only), since an inert element cannot be scrolled.
  if (scope.kind === "part") return <div ref={frame} className="comparison-preview" tabIndex={0}><div inert><ChromePreview config={previewConfig} part={scope.part} imageBase={`/api/shops/${shopId}/images`} /></div></div>;
  return <div ref={frame} className={`comparison-preview${scope.kind === "page" ? " comparison-preview-page" : ""}`} tabIndex={0}><div inert><ApiProvider value={mock}><PublicShop key={JSON.stringify(value)} session={session} slug="local-preview" search="" initialPane="reserve" pageSlug={scope.kind === "page" ? (value as ShopPage).slug : undefined} busy={false} run={async fn => { try { await fn(); } catch { /* Read-only comparison. */ } }} notify={() => {}} navigate={() => {}} /></ApiProvider></div></div>;
}
