import React, { useEffect, useMemo, useState } from "react";
import { ApiProvider } from "./api";
import { PublicShop, type Session } from "./App";
import { createPreviewClient } from "./local-preview";
import type { DriveMock } from "../server/drive-mock";
import type { PostCategory } from "../server/post-domain";

export function DrivePreview({ mock }: { mock: DriveMock }) {
  useEffect(() => { document.title = `${mock.shop.name} — ご予約`; }, [mock.shop.name]);
  const shopId = "drive-preview";
  const client = useMemo(() => createPreviewClient(mock.shop, { customerName: mock.auth.name, bookings: [], posts: [] }, shopId), [mock]);
  const [route, setRoute] = useState<{ pane: string; category?: PostCategory; articleKey?: string; pageSlug?: string }>({ pane: "reserve" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const session: Session = { demo: false, user: { ...mock.auth, role: "customer", shopId } };
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <ApiProvider value={client}>
    <div className="preview-banner">ローカルプレビュー · 予約・問い合わせの操作は保存されません。</div>
    {error && <p className="alert" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <PublicShop key={JSON.stringify(route)} session={session} slug="local-preview" search="" initialPane={route.pane} onPaneChange={pane => setRoute({ pane })} category={route.category} articleKey={route.articleKey} pageSlug={route.pageSlug} preview={false} busy={busy} run={run} notify={setNotice} navigate={href => {
      const url = new URL(href, "https://preview.invalid");
      const match = url.pathname.match(/^\/s\/local-preview\/(blogs|announcements|pages)(?:\/([^/]+))?$/);
      if (match?.[1] === "pages") setRoute({ pane: "reserve", pageSlug: match[2] });
      else if (match) setRoute({ pane: "reserve", category: match[1] as PostCategory, articleKey: match[2] });
      else setRoute({ pane: url.searchParams.get("pane") || "reserve" });
    }} />
  </ApiProvider>;
}
