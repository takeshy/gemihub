import { tr } from "../shared/i18n";
import React, { useEffect, useState } from "react";
import { z } from "zod";
import { ConfigEditor, type Workspace } from "./App";
import { useApi } from "./api";
import { shopSchema, type ShopConfig } from "../server/domain";
import { liveValue, type LiveSection } from "../server/live-settings";
import { createRequestId } from "./request-id";
const pendingSchema = z.object({ config: shopSchema, previous: z.unknown(), requestId: z.uuid() });
type Pending = z.infer<typeof pendingSchema>;
export function LiveSettings({ shop, section, reload }: { shop: Workspace; section: LiveSection; reload: () => Promise<unknown> }) {
  const api = useApi();
  const [config, setConfig] = useState<ShopConfig>();
  const [source, setSource] = useState<ShopConfig>();
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const key = `gemihub:live-save:${shop.owner}:${shop.id}:${section}`;
  async function load() {
    const data = await api<{ config: ShopConfig }>(`/api/shops/${shop.id}/live-settings/${section}`);
    setConfig(data.config); setSource(data.config);
  }
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const cached = pendingSchema.parse(JSON.parse(raw));
        setPending(cached); setConfig(cached.config); setNotice(tr("未完了の保存があります。保存を再試行してください。")); return;
      }
      void load().catch(e => setError(e.message));
    } catch { setError(tr("保存中のデータを読み込めませんでした。最新の内容を読み直してください。")); }
  }, [key]);
  return <div className={`panel live-settings live-settings-${section}`}>
    <h2>{{ basic: tr("お店の基本情報"), menus: tr("メニュー・料金"), staff: tr("スタッフ・勤務"), hours: tr("営業時間・休業日"), rules: tr("予約ルール") }[section]}</h2>
    <p>{shop.publication === "provisional" ? tr("仮公開中のお店の設定です。「保存」で仮公開の内容に反映します。") : tr("本番のお店のデータです。「保存」で反映します。")}</p>
    {section === "menus" && <p className="small muted">{tr("新しいメニューは無効の状態で追加します。スタッフの対応メニューに追加してから有効にしてください。")}</p>}
    {error && <p className="alert" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {!config && <p>{tr("お店の共通設定を反映すると管理できます。")}</p>}
    {config && <fieldset disabled={busy || imageUploading || !!pending}><ConfigEditor shopId={shop.id} onImageUploading={setImageUploading} section={section} config={config} onChange={value => { setConfig(value); setNotice(""); }} /></fieldset>}
    <div className="actions">
      <button disabled={busy || imageUploading} onClick={async () => {
        if ((pending || config && JSON.stringify(config) !== JSON.stringify(source)) && !window.confirm(tr("編集を破棄して最新の本番データを読み直しますか？"))) return;
        setBusy(true); setError("");
        try { await load(); localStorage.removeItem(key); setPending(undefined); setNotice(""); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
      }}>{tr("最新の内容を読み直す")}</button>
      <button className="primary" disabled={busy || imageUploading || (!pending && (!config || !source || JSON.stringify(liveValue(config, section)) === JSON.stringify(liveValue(source, section))))} onClick={async () => {
        if (!pending && (!config || !source)) return;
        setBusy(true); setError(""); setNotice("");
        try {
          let action = pending;
          if (!action) {
            const checked = shopSchema.safeParse(config);
            if (!checked.success) throw new Error(checked.error.issues[0].message);
            action = { config: checked.data, previous: liveValue(source!, section), requestId: createRequestId() };
            localStorage.setItem(key, JSON.stringify(action)); setPending(action);
          }
          await api(`/api/shops/${shop.id}/live-settings/${section}`, { value: liveValue(action.config, section), previous: action.previous, requestId: action.requestId });
          await load(); localStorage.removeItem(key); setPending(undefined); await reload(); setNotice(shop.publication === "provisional" ? tr("保存して仮公開に反映しました。") : tr("保存して本番に反映しました。"));
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
      }}>{pending ? tr("保存を再試行") : tr("保存")}</button>
    </div>
  </div>;
}
