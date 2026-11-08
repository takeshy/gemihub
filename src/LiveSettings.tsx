import { tr } from "../shared/i18n";
import React, { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ConfigEditor, type Workspace } from "./App";
import { useApi } from "./api";
import { shopSchema, ownerStaffId, type ShopConfig } from "../server/domain";
import { liveValue, updateLiveValue, type LiveSection } from "../server/live-settings";
import type { SettingsProposal } from "../server/settings-ai";
import { createRequestId } from "./request-id";
const pendingSchema = z.object({ config: shopSchema, requestId: z.uuid() });
type Pending = z.infer<typeof pendingSchema>;
export function LiveSettings({ shop, section, reload }: { shop: Workspace; section: LiveSection; reload: () => Promise<unknown> }) {
  const api = useApi();
  const [config, setConfig] = useState<ShopConfig>();
  const [source, setSource] = useState<ShopConfig>();
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const [proposal, setProposal] = useState<SettingsProposal>();
  const aiRequest = useRef<{ input: string; id: string } | undefined>(undefined);
  const heading = { basic: tr("お店の基本情報"), menus: tr("メニュー・料金"), staff: tr("スタッフ・勤務"), hours: tr("営業時間・休業日"), rules: tr("予約ルール") }[section];
  const key = `gemihub:live-save:${shop.owner}:${shop.id}:${section}`;
  async function load() {
    const data = await api<{ config: ShopConfig }>(`/api/shops/${shop.id}/live-settings/${section}`);
    setConfig(data.config); setSource(data.config);
  }
  useEffect(() => {
    let cancelled = false;
    let cached: Pending | undefined;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        cached = pendingSchema.parse(JSON.parse(raw));
        setPending(cached); setConfig(cached.config); setNotice(tr("保存が完了していません。「保存」で再試行するか、保存待ちを取り消して本番の設定に戻せます。"));
      }
    } catch {
      localStorage.removeItem(key);
    }
    // Always read saved settings, even when an interrupted save exists in this browser.
    // A matching result means the save succeeded but its response was lost.
    void api<{ config: ShopConfig }>(`/api/shops/${shop.id}/live-settings/${section}`).then(data => {
      if (cancelled) return;
      setSource(data.config);
      if (!cached || JSON.stringify(liveValue(cached.config, section)) === JSON.stringify(liveValue(data.config, section))) {
        setConfig(data.config); setPending(undefined);
        if (cached) {
          localStorage.removeItem(key);
          setNotice(tr("保存しました。"));
        }
      }
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [key]);
  return <div className={`panel live-settings live-settings-${section}`}>
    <div className="section-top"><h2>{heading}</h2><button type="button" aria-expanded={aiOpen} disabled={busy || imageUploading || !!pending || !config || !source} onClick={() => { setAiOpen(!aiOpen); setProposal(undefined); }}>{tr("AIで設定")}</button></div>
    <p>{shop.publication === "provisional" ? tr("仮公開中のお店の設定です。「保存」で仮公開の内容に反映します。") : tr("本番のお店のデータです。「保存」で反映します。")}</p>
    {section === "menus" && <p className="small muted">{config && (config.ownerBooking || !config.staff.length) && !config.staff.find(staff => staff.id === ownerStaffId)?.customAvailability ? tr("店主がすべてのメニューを担当します。新しいメニューは内容を確認してから有効にしてください。") : tr("新しいメニューは無効の状態で追加します。スタッフの対応メニューに追加してから有効にしてください。")}</p>}
    {error && <p className="alert" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {aiOpen && <section className="settings-ai" aria-label={tr("AIで{0}を設定", heading)}>
      <p>{tr("メモや参考URLから設定案を作ります。内容を確認して入力欄に反映し、「保存」を押すまでお店の設定は変わりません。")}</p>
      {section === "rules" && <p className="small">{tr("返金率もここで変更案を作れます。たとえば「12時間前まで80%返金、1時間前まで50%返金」。キャンセル料で依頼することもできます。変更は保存後の新しい予約に適用されます。")}</p>}
      <label>{tr("メモ・参考URL")}<textarea aria-label={tr("メモ・参考URL")} rows={5} maxLength={12000} disabled={busy} value={aiNote} onChange={event => { setAiNote(event.target.value); setProposal(undefined); }} placeholder={tr("お店の紹介や料金表のメモ、参考にしたい公開ページのURLを入力してください。")}/></label>
      <p className="small muted">{tr("ログイン不要のWebページを3件まで参照できます。読み取れないページは、必要な部分をメモとして貼り付けてください。")}</p>
      <div className="actions"><button type="button" disabled={busy || !aiNote.trim()} onClick={async () => {
        if (!config) return;
        setBusy(true); setError(""); setNotice(""); setProposal(undefined);
        try {
          const value = liveValue(config, section), note = aiNote.trim(), input = JSON.stringify({ note, value });
          if (!aiRequest.current || aiRequest.current.input !== input) aiRequest.current = { input, id: createRequestId() };
          const result = await api<SettingsProposal>(`/api/shops/${shop.id}/live-settings/${section}/ai`, { note, value, requestId: aiRequest.current.id });
          updateLiveValue(config, section, result.value);
          setProposal(result); aiRequest.current = undefined;
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
      }}>{busy ? tr("設定案を作成しています…") : tr("設定案を作る")}</button>
      <button type="button" disabled={busy} onClick={() => { setAiOpen(false); setProposal(undefined); }}>{tr("閉じる")}</button></div>
      {busy && <p role="status">{tr("参考ページとメモを確認しています。しばらくお待ちください。")}</p>}
      {proposal && <div className="settings-ai-review">
        <h3>{tr("設定案を確認")}</h3>
        {!proposal.changes.length && <p>{tr("設定できる変更が見つかりませんでした。料金や所要時間など、足りない情報をメモに補足してください。")}</p>}
        <dl>{proposal.changes.map((change, index) => <div className="settings-ai-change" key={index}><dt>{change.label}</dt><dd><span>{tr("現在")}</span><div>{change.before}</div></dd><dd><span>{tr("設定案")}</span><div>{change.after}</div></dd></div>)}</dl>
        {!!proposal.warnings.length && <ul className="settings-ai-warnings">{proposal.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        {!!proposal.sources.length && <div className="settings-ai-sources"><h4>{tr("参照したページ")}</h4><ul>{proposal.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a></li>)}</ul></div>}
        <button type="button" className="primary" disabled={busy || !proposal.changes.length} onClick={() => {
          if (!config) return;
          setConfig(updateLiveValue(config, section, proposal.value)); setProposal(undefined); setAiOpen(false);
          setNotice(tr("入力欄に反映しました。内容を確認し、「保存」でお店に反映してください。"));
        }}>{tr("入力欄に反映")}</button>
      </div>}
    </section>}
    {!config && <p>{tr("お店の共通設定を反映すると管理できます。")}</p>}
    {config && <fieldset disabled={busy || imageUploading || !!pending || !!proposal}><ConfigEditor shopId={shop.id} onImageUploading={setImageUploading} section={section} config={config} onChange={value => { setConfig(value); setNotice(""); }} /></fieldset>}
    <div className="actions">
      <button className="primary" disabled={busy || imageUploading || !!proposal || (!pending && (!config || !source || JSON.stringify(liveValue(config, section)) === JSON.stringify(liveValue(source, section))))} onClick={async () => {
        if (!pending && (!config || !source)) return;
        setBusy(true); setSaving(true); setError(""); setNotice("");
        try {
          let action = pending;
          if (!action) {
            const checked = shopSchema.safeParse(config);
            if (!checked.success) throw new Error(checked.error.issues[0].message);
            action = { config: checked.data, requestId: createRequestId() };
            localStorage.setItem(key, JSON.stringify(action)); setPending(action);
          }
          await api(`/api/shops/${shop.id}/live-settings/${section}`, { value: liveValue(action.config, section), requestId: action.requestId });
          await load(); localStorage.removeItem(key); setPending(undefined); await reload(); setNotice(tr("保存しました。"));
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); setSaving(false); }
      }}>{saving ? tr("保存しています…") : tr("保存")}</button>
      {pending && <button type="button" disabled={busy || imageUploading} onClick={async () => {
        setBusy(true); setError("");
        try {
          // The server rejects this read while a publication needs to finish. Never
          // abandon its retry state or unlock editing until the saved state is known.
          await load();
          localStorage.removeItem(key); setPending(undefined); setProposal(undefined); setAiOpen(false);
          await reload(); setNotice(tr("保存待ちの変更を取り消し、本番の設定を読み込みました。"));
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
      }}>{tr("保存待ちを取り消して本番の設定に戻す")}</button>}
    </div>
  </div>;
}
