import { useState } from "react";
import { useFetcher } from "react-router";
import { useI18n } from "~/i18n/context";
import { KakerattaSettingsSchema, type KakerattaProfile } from "~/types/kakeratta";
import { getAvailableModels, getEnabledMcpServers, type UserSettings } from "~/types/settings";
import { browserTimelineInput, applyBrowserTimelineResult } from "~/services/timeline-sync-client";
import { SaveButton } from "./shared";

export function KakerattaTab({ settings }: { settings: UserSettings }) {
  const { language } = useI18n();
  const ja = language === "ja";
  const ragBlockedByVertex = settings.usePersonalVertex === true;
  const [config, setConfig] = useState(() => KakerattaSettingsSchema.parse(settings.kakeratta ?? {}));
  const [headers, setHeaders] = useState(() => Object.entries(config.headers));
  const [personas, setPersonas] = useState<{ id: string; name: string; planner: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const fetcher = useFetcher<{ success?: boolean; message?: string }>();
  const field = "w-full rounded border border-gray-300 bg-white p-2 text-sm dark:border-gray-700 dark:bg-gray-950";
  function currentConfig() {
    const names = headers.map(([name]) => name.trim().toLowerCase());
    if (new Set(names).size !== names.length) throw new Error(ja ? "ヘッダー名が重複しています。" : "Duplicate header names.");
    return KakerattaSettingsSchema.parse({ ...config,
      ...(ragBlockedByVertex ? {
        defaultProfile: { ...config.defaultProfile, ragSetting: null },
        direct: { ...config.direct, ragSetting: null },
        personas: Object.fromEntries(Object.entries(config.personas).map(([id, profile]) => [id, { ...profile, ragSetting: null }])),
      } : {}),
      headers: Object.fromEntries(headers.map(([name, value]) => [name.trim(), value])) });
  }
  async function syncNow() {
    setLoading(true); setError(""); setSyncStatus("");
    try {
      const input = await browserTimelineInput(settings.kakeratta);
      const response = await fetch("/api/kakeratta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "timeline", timelineFiles: input.timelineFiles, timelineRootFolderId: input.timelineRootFolderId }) });
      const result = await response.json();
      await applyBrowserTimelineResult(result.timeline, input);
      if (!response.ok || result.timeline?.error) throw new Error(result.error ?? result.timeline?.error ?? "Timeline synchronization failed");
      setSyncStatus(result.busy || result.timeline?.busy ? (ja ? "同期処理を実行中です。" : "Synchronization is already running.")
        : result.timeline?.pending ? (ja ? "一部の投稿は再試行を待っています。" : "Some posts are waiting for retry.")
        : result.timeline?.backfillPending ? (ja ? "同期しました。過去の投稿の取り込みは次の確認で続きます。" : "Synchronized. Historical imports continue on the next check.")
        : ja ? "Timeline を同期しました。" : "Timeline synchronized.");
    } catch (error) { setError(error instanceof Error ? error.message : "Timeline synchronization failed"); }
    finally { setLoading(false); }
  }
  async function loadPersonas() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/kakeratta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "personas", config: currentConfig() }) });
      if (!response.ok) throw new Error(ja ? "接続できません。URL とヘッダーを確認してください。" : "Connection failed. Check the URL and headers.");
      const result = await response.json();
      setPersonas(Array.isArray(result.personas) ? result.personas : []);
    } catch (err) { setError(err instanceof Error ? err.message : "Connection failed"); }
    finally { setLoading(false); }
  }
  function profileEditor(profile: KakerattaProfile, change: (profile: KakerattaProfile) => void) {
    return <div className="space-y-3">
      <label className="block">{ja ? "回答モデル" : "Answer model"}
        <select className={field} value={profile.model} onChange={e => change({ ...profile, model: e.target.value })}>
          <option value="">{ja ? "GemiHub の既定モデル" : "GemiHub default model"}</option>
          {getAvailableModels(settings.apiPlan).filter(m => !m.isImageModel).map(m => <option key={m.name} value={m.name}>{m.displayName}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={profile.readFiles} onChange={e => change({ ...profile, readFiles: e.target.checked })} />{ja ? "GemiHub のファイル・タイムラインを読み取り専用で参照" : "Read GemiHub files and timeline (read-only)"}</label>
      <label className="block">RAG
        <select className={field} disabled={ragBlockedByVertex} value={ragBlockedByVertex ? "" : profile.ragSetting ?? ""} onChange={e => change({ ...profile, ragSetting: e.target.value || null })}>
          <option value="">{ja ? "なし" : "None"}</option>
          {!ragBlockedByVertex && Object.keys(settings.ragSettings).map(name => <option key={name}>{name}</option>)}
        </select>
      </label>
      {ragBlockedByVertex && <p>{ja ? "個人 Vertex AI では RAG は利用できません。保存すると既存の RAG 設定も「なし」になります。" : "RAG is unavailable with personal Vertex AI. Saving also clears existing RAG selections."}</p>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={profile.webSearch} onChange={e => change({ ...profile, webSearch: e.target.checked })} />{ja ? "Web 検索（対応モデルのみ）" : "Web Search (supported models)"}</label>
    </div>;
  }
  const ids = Array.from(new Set([...personas.map(p => p.id), ...Object.keys(config.personas)]));
  return <fetcher.Form method="post" action="/settings" className="space-y-5 text-sm text-gray-800 dark:text-gray-200" onSubmit={event => {
    event.preventDefault(); setError("");
    try { fetcher.submit({ _action: "saveKakeratta", kakeratta: JSON.stringify(currentConfig()) }, { method: "post", action: "/settings" }); }
    catch { setError(ja ? "ヘッダー名と値を確認してください。値に改行は使えません。" : "Check header names and values. Newlines are not allowed."); }
  }}>
    <h2 className="text-lg font-semibold">Kakeratta</h2>
    <p>{ja ? "Kakeratta の外部エージェントとして担当の依頼に回答します。Kakeratta の設定で MCP 接続を発行し、対象の担当を外部エージェントに切り替えてください。" : "Answer persona requests as a Kakeratta external agent. Create an MCP connection in Kakeratta and switch the personas to that external agent."}</p>
    <p>{ja ? "通常は GemiHub の画面を開いている間に1分ごとに確認します。Premium では画面を閉じてもサーバーが毎分確認します。定期確認をオフにすると画面を開いた時に1回だけ確認します。" : "Check every minute while GemiHub is open. Premium also checks on the server while the page is closed. Turning off periodic checks runs once when the page opens."}</p>
    <p>{ja ? "回答生成には選択した AI 提供元の料金・残高が適用されます。認証ヘッダーは Drive の設定に保存されます。ファイル参照をオンにすると GemiHub の保存領域全体が対象になります。" : "Answer generation uses your selected AI provider's billing or balance. Authentication headers are stored in Drive settings. File access covers the GemiHub storage root."}</p>
    <label className="flex items-center gap-2"><input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} />{ja ? "連携を有効にする" : "Enable integration"}</label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={config.pollEnabled} onChange={e => setConfig({ ...config, pollEnabled: e.target.checked })} />{ja ? "定期確認" : "Periodic checks"}</label>
    <label className="block">MCP URL<input className={field} type="url" value={config.url} onChange={e => setConfig({ ...config, url: e.target.value })} placeholder="https://…/mcp" required={config.enabled} /></label>
    <div className="space-y-2"><p>{ja ? "HTTP ヘッダー（Authorization: Bearer 発行キー）" : "HTTP headers (Authorization: Bearer issued-key)"}</p>
      {headers.map(([name, value], index) => <div className="flex gap-2" key={index}>
        <input aria-label={ja ? "ヘッダー名" : "Header name"} className={field} value={name} onChange={e => setHeaders(headers.map((row, i) => i === index ? [e.target.value, value] : row))} />
        <input aria-label={ja ? "ヘッダー値" : "Header value"} className={field} type="password" value={value} autoComplete="off" onChange={e => setHeaders(headers.map((row, i) => i === index ? [name, e.target.value] : row))} />
        <button type="button" onClick={() => setHeaders(headers.filter((_, i) => i !== index))}>{ja ? "削除" : "Remove"}</button>
      </div>)}
      <button type="button" onClick={() => setHeaders([...headers, ["", ""]])}>{ja ? "ヘッダーを追加" : "Add header"}</button>
    </div>
    <section className="space-y-3 rounded-lg border p-4 dark:border-gray-700">
      <h3 className="font-semibold">{ja ? "Timeline 同期（Premium）" : "Timeline synchronization (Premium)"}</h3>
      <label className="flex items-center gap-2"><input type="checkbox" checked={config.timelineSync.enabled}
        onChange={e => setConfig({ ...config, timelineSync: { ...config.timelineSync, enabled: e.target.checked } })} />
        {ja ? "Kakeratta と Timeline を同期する" : "Synchronize Timeline with Kakeratta"}</label>
      <label className="block">{ja ? "同期する Timeline 名" : "Timeline name"}
        <input className={field} value={config.timelineSync.name} onChange={e => setConfig({ ...config, timelineSync: { ...config.timelineSync, name: e.target.value } })} /></label>
      <p>{ja ? "投稿・返信・担当名を同期します。競合時は Kakeratta を優先し、GemiHub の変更を競合コピーとして残します。競合コピーは Kakeratta に送信しません。初回の過去投稿の取り込みでは担当を起動しません。" : "Synchronize posts, replies and author names. Kakeratta wins conflicts; your GemiHub changes are kept as local conflict copies and are never sent to Kakeratta. Historical imports do not wake personas."}</p>
      <p>{ja ? "同期を開始してから追加した投稿や返信では、Kakeratta 側の設定で担当の回答が生成され、その提供元の料金が適用されます。" : "Posts and replies added after enabling synchronization can generate persona answers using your Kakeratta settings and its provider's billing."}</p>
      <button type="button" disabled={loading || !settings.kakeratta?.enabled || !settings.kakeratta?.timelineSync?.enabled} onClick={syncNow}>
        {loading ? "…" : ja ? "保存した設定で今すぐ同期" : "Synchronize now with saved settings"}
      </button>
      {syncStatus && <p role="status" className="text-green-700 dark:text-green-300">{syncStatus}</p>}
    </section>
    <section className="space-y-3 rounded-lg border p-4 dark:border-gray-700"><h3 className="font-semibold">{ja ? "共通設定" : "Default profile"}</h3>{profileEditor(config.defaultProfile, profile => setConfig({ ...config, defaultProfile: profile }))}</section>
    <section className="space-y-3 rounded-lg border p-4 dark:border-gray-700">
      <h3 className="font-semibold">{ja ? "エージェントへの直接依頼" : "Direct requests to the agent"}</h3>
      <p>{ja ? "Kakeratta で @agent・@エージェント・@外部エージェント と呼びかけた依頼に返信します。担当別設定とは独立しています。" : "Reply to Kakeratta requests addressed to @agent, @エージェント or @外部エージェント. These settings are independent of persona profiles."}</p>
      <label className="flex items-center gap-2"><input type="checkbox" checked={config.direct.enabled} onChange={e => setConfig({ ...config, direct: { ...config.direct, enabled: e.target.checked } })} />{ja ? "直接依頼に応答する" : "Answer direct requests"}</label>
      {profileEditor(config.direct, profile => setConfig({ ...config, direct: { ...config.direct, ...profile } }))}
      <p>{ja ? "使用する外部 MCP サーバーを選択してください。既に許可したツールだけを使います。送信・更新などは直接依頼で明示された操作に限ります。" : "Select external MCP servers. Only previously approved tools are available. Sending or updating requires an explicit direct request."}</p>
      {getEnabledMcpServers(settings).filter(server => server.id).map(server => <label key={server.id} className="flex items-center gap-2"><input type="checkbox" checked={config.direct.mcpServerIds.includes(server.id!)} onChange={e => setConfig({ ...config, direct: { ...config.direct, mcpServerIds: e.target.checked ? [...config.direct.mcpServerIds, server.id!] : config.direct.mcpServerIds.filter(id => id !== server.id) } })} />{server.name}</label>)}
    </section>
    <button type="button" disabled={loading} onClick={loadPersonas}>{loading ? "…" : ja ? "担当一覧を取得・接続確認" : "Load personas / test connection"}</button>
    {ids.map(id => {
      const persona = personas.find(p => p.id === id);
      const override = Object.hasOwn(config.personas, id);
      return <section key={id} className="space-y-3 rounded-lg border p-4 dark:border-gray-700">
        <h3 className="font-semibold">{persona?.name ?? id} {persona?.planner === "builtin" ? (ja ? "（Kakeratta 側で外部エージェントへの切替が必要）" : "(switch to external agent in Kakeratta)") : ""}</h3>
        <label className="flex items-center gap-2"><input type="checkbox" checked={override} onChange={e => {
          const profiles = { ...config.personas };
          if (e.target.checked) profiles[id] = { ...config.defaultProfile };
          else delete profiles[id];
          setConfig({ ...config, personas: profiles });
        }} />{ja ? "担当別に設定する" : "Override default profile"}</label>
        {override && profileEditor(config.personas[id], profile => setConfig({ ...config, personas: { ...config.personas, [id]: profile } }))}
      </section>;
    })}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {fetcher.data?.message && <p role="status" className={fetcher.data.success ? "text-green-600" : "text-red-600"}>{fetcher.data.message}</p>}
    <SaveButton loading={fetcher.state !== "idle"} />
  </fetcher.Form>;
}
