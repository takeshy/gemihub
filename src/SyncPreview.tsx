import React, { useMemo } from "react";
import { ApiProvider } from "./api";
import { ChromePreview } from "./SiteChrome";
import { PublicShop, type Session } from "./App";
import { replaceScope } from "./editor-sync";
import { createPreviewClient, type Fixtures } from "./local-preview";
import type { ShopConfig } from "../server/domain";
import type { ReleaseScope, ShopPage } from "../server/pages";
export function SyncPreview({ config, value, scope, fixtures, shopId }: { config: ShopConfig; value: unknown; scope: ReleaseScope; fixtures: Fixtures; shopId: string }) {
  const previewConfig = useMemo(() => {
    if (value === null) return config;
    if (scope.kind === "page") return replaceScope({ ...config, pages: [] }, scope, value);
    return replaceScope(config, scope, value);
  }, [config, value, JSON.stringify(scope)]);
  const mock = useMemo(() => createPreviewClient(previewConfig, fixtures, shopId), [previewConfig, fixtures, shopId]);
  const session: Session = { demo: false, user: { email: "sample@example.com", name: fixtures.customerName, role: "customer", shopId } };
  if (value === null) return <p className="notice">この側では{scope.kind === "page" ? "ページが削除されています（または未作成）" : "お店が未公開です"}。</p>;
  if (scope.kind === "part") return <div inert className="comparison-preview"><ChromePreview config={previewConfig} part={scope.part} /></div>;
  return <div inert className="comparison-preview"><ApiProvider value={mock}><PublicShop key={JSON.stringify(value)} session={session} slug="local-preview" search="" initialPane="reserve" pageSlug={scope.kind === "page" ? (value as ShopPage).slug : undefined} preview={false} busy={false} run={async fn => { try { await fn(); } catch { /* Read-only comparison. */ } }} notify={() => {}} navigate={() => {}} /></ApiProvider></div>;
}
