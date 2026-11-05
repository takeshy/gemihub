import { getLocale, intlLocale, tr } from "../shared/i18n";
import React, { useEffect, useRef, useState } from "react";
import { useApi } from "./api";
import { submitOnShortcut } from "./submit-shortcut";
import { ConfigSummary, type Plan, type Workspace } from "./App";
import { AssistantAnswer } from "./AssistantAnswer";
import { paid } from "./money";
import type { PayPalAlertItem, PayPalAlertState, PayPalProposal, PayPalProposalOperation, PayPalSeverity, PayPalAlertKind } from "../server/paypal-ops";
import "./Assistant.css";
import { z } from "zod";

type Source = { path: string; title: string };
type Reply = { answer: string; sources: Source[]; request?: string; paypalProposals?: PayPalProposal[] };
type Message = { role: "user" | "assistant"; text: string; sources?: Source[]; voice?: boolean };
const savedAssistantSchema = z.object({
  messages: z.array(z.object({role:z.enum(["user","assistant"]),text:z.string().max(20000),sources:z.array(z.object({path:z.string(),title:z.string()})).optional(),voice:z.boolean().optional()})).max(100),
  text:z.string().max(4000),draft:z.string().max(10000).optional(),planId:z.string().optional(),
});

/**
 * The shop assistant: questions answered from spec.md, history.md and the system OKF bundle.
 * A change request becomes an editable draft; approving it creates an ordinary change plan,
 * which is reviewed and applied exactly like other plans.
 */
export function Assistant({ shop, voice, userEmail, acceptPlan, reload }: { shop: Workspace; voice: boolean; userEmail: string; acceptPlan: (plan: Plan) => Promise<void>; reload: () => Promise<unknown> }) {
  const api = useApi();
  const storageKey = `gemihub:assistant:${shop.id}:${userEmail}`;
  const [saved] = useState(() => { try { return savedAssistantSchema.parse(JSON.parse(localStorage.getItem(storageKey) || "null")); } catch { return undefined; } });
  const [messages, setMessages] = useState<Message[]>(saved?.messages || []);
  const [text, setText] = useState(saved?.text || "");
  const [mode, setMode] = useState<"chat" | "voice">("chat");
  const voiceMode = voice && mode === "voice";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<string|undefined>(saved?.draft);
  const [plan, setPlan] = useState<Plan|undefined>(()=>shop.plans.find(plan=>plan.id===saved?.planId&&plan.base===shop.revision&&!plan.approved));
  const [proposals, setProposals] = useState<PayPalProposal[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<PayPalAlertState>();
  const [notifySetting, setNotifySetting] = useState(shop.paypalSettings?.enabled !== false);
  const [digestHour, setDigestHour] = useState(shop.paypalSettings?.digestHour ?? 9);
  const alerts = shop.paypalAlerts;
  const log = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { try { localStorage.setItem(storageKey,JSON.stringify({messages:messages.slice(-100),text,draft,planId:plan?.id})); } catch { /* Storage may be unavailable in private browsing. */ } },[storageKey,messages,text,draft,plan?.id]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages.length, draft, plan?.id]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); } finally { if (alive.current) setBusy(false); }
  }
  const history = () => messages.slice(-12).map(({ role, text }) => ({ role, text: text.slice(0, 4000) }));
  function ask(question = text) {
    const value = question.trim();
    if (!value) return;
    void run(async () => {
      const earlier = history();
      setMessages(items => [...items, { role: "user", text: value }]);
      setText("");
      try {
        const reply = await api<Reply>(`/api/shops/${shop.id}/assistant`, { question: value, messages: earlier });
        if (!alive.current) return;
        setMessages(items => [...items, { role: "assistant", text: reply.answer, sources: reply.sources }]);
        setProposals(reply.paypalProposals || []);
        if (reply.request) { setDraft(reply.request); setPlan(undefined); }
      } catch (e) { setText(value); throw e; }
    });
  }
  const executeProposal = (proposal: PayPalProposal) => run(async () => {
    try {
      const result = await api<{ ok: boolean; error?: string; state?: PayPalAlertState }>(`/api/shops/${shop.id}/paypal/proposals/execute`, {
        proposalId: proposal.id, alertId: proposal.alertId, fingerprint: proposal.fingerprint,
      });
      if (!result.ok) throw new Error(result.error || tr("状態が変わっています。最新の状態を確認してください。"));
    } catch (error) {
      setProposals([]);
      await reload().catch(() => {});
      throw error;
    }
    setProposals(items => items.filter(item => item.id !== proposal.id));
    setMessages(items => [...items, { role: "assistant", text: tr("実行しました：{0}。最新の状態を表示しています。", proposalOpText(proposal.operation)) }]);
    await reload();
  });
  const checkNow = () => run(async () => {
    setChecking(true);
    try {
      const result = await api<PayPalAlertState>(`/api/shops/${shop.id}/paypal/alerts/check`, {});
      setCheckResult(result);
      await reload();
    }
    finally { setChecking(false); }
  });
  const saveAlertSettings = () => run(async () => {
    await api(`/api/shops/${shop.id}/paypal/alerts/settings`, { notify: notifySetting, digestHour });
    await reload();
  });
  const approveDraft = () => run(async () => {
    const next = await api<Plan>(`/api/shops/${shop.id}/plan`, { text: draft, intent: "modify" });
    if (!alive.current) return;
    setPlan(next); setDraft(undefined);
  });
  return <section className="panel assistant" aria-labelledby="assistant-title">
    <div className="section-top"><span className="ai-mark">✳</span><div>
      <h2 id="assistant-title">{tr("相談・質問")}</h2>
      <p className="small muted">{tr("お店の仕様（spec.md）と変更履歴（history.md）、gemihub の仕組みの説明をもとに答えます。変更を頼むと依頼文の下書きを作り、承認するまで何も反映しません。")}</p>
    </div></div>
    {shop.isOwner && <AlertPanel alerts={alerts} checkResult={checkResult} checking={checking} busy={busy} notify={notifySetting} digestHour={digestHour} onNotify={setNotifySetting} onDigestHour={setDigestHour} onSaveSettings={() => void saveAlertSettings()} onCheck={() => void checkNow()} onAsk={question => ask(question)} onExecute={proposal => void executeProposal(proposal)} />}
    {voice && <div className="assistant-modes" role="group" aria-label={tr("相談の方法")}>
      <button type="button" aria-pressed={!voiceMode} onClick={() => setMode("chat")}>{tr("チャットで質問")}</button>
      <button type="button" aria-pressed={voiceMode} onClick={() => setMode("voice")}>{tr("AIと話す")}</button>
    </div>}
    <div ref={log} className="chat-log assistant-log" role="log" aria-label={tr("アシスタントとの会話")} aria-live="polite">
      {!messages.length && <p className="muted">{tr("例：「キャンセルしたら返金はどうなる？」「なぜ水曜が定休日なの？」「来月から水曜を定休日にして」")}</p>}
      {messages.map((message, index) => <article key={index} className={`chat-message chat-message-${message.role}`}>
        <b>{message.role === "user" ? tr("あなた") : "AI"}{message.voice && <small className="muted">{tr("（音声）")}</small>}</b>
        {message.role === "assistant" ? <AssistantAnswer text={message.text} /> : <div className="pre-wrap">{message.text}</div>}
        {!!message.sources?.length && <p className="assistant-sources small muted">{tr("根拠：")}{message.sources.map(source => <span key={source.path} className="pill" title={source.path}>{source.title}</span>)}</p>}
      </article>)}
      {busy && <p role="status">{tr("AIが考えています…")}</p>}
    </div>
    {!!proposals.length && <section className="paypal-proposals" aria-label={tr("PayPalの提案")}>
      <h3>{tr("PayPalの提案")}</h3>
      <p className="small muted">{tr("内容を確認し、実行してよいものだけ承認してください。サーバーが実行前に状態を再確認します。")}</p>
      {proposals.map(proposal => <ProposalCard key={proposal.id} proposal={proposal} busy={busy} owner={shop.isOwner} onExecute={() => void executeProposal(proposal)} />)}
    </section>}
    {error && <p className="alert" role="alert">{error}</p>}
    {draft !== undefined && <section className="assistant-draft" aria-label={tr("依頼文の下書き")}>
      <h3>{tr("依頼文の下書き")}</h3>
      <p className="small muted">{shop.isOwner ? tr("内容を確認し、必要なら直してから承認してください。承認すると変更プランを作ります。プランをもう一度確認するまで反映されません。音声での了承は承認になりません。") : tr("変更の承認は店主だけができます。この下書きを店主に伝えてください。")}</p>
      <textarea aria-label={tr("依頼文")} rows={10} maxLength={10000} value={draft} disabled={busy || !shop.isOwner} onChange={event => setDraft(event.target.value)} />
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => setDraft(undefined)}>{tr("破棄する")}</button>
        {shop.isOwner && <button type="button" className="primary" disabled={busy || !draft?.trim()} onClick={() => void approveDraft()}>{tr("承認して変更プランを作る")}</button>}
      </div>
    </section>}
    {plan && <section className="request-review" aria-label={tr("変更案の確認")}>
      <h3>{tr("このように変更してよいですか？")}</h3>
      <ul className="check-list">{plan.summary.map((summary, index) => <li key={index}>{summary}</li>)}</ul>
      <ConfigSummary config={plan.config} />
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => setPlan(undefined)}>{tr("やめる")}</button>
        <button type="button" className="primary" disabled={busy} onClick={() => void run(async () => { await acceptPlan(plan); if (alive.current) { setPlan(undefined); setMessages(items => [...items, { role: "assistant", text: tr("変更を反映しました。変更履歴に依頼文とあわせて記録しました。") }]); } })}>{tr("この内容で反映する")}</button>
      </div>
    </section>}
    {voiceMode ? <LiveVoice shopId={shop.id} disabled={busy} context={history} onTurn={(question, answer, sources) => setMessages(items => [...items, ...(question ? [{ role: "user" as const, text: question, voice: true }] : []), ...(answer ? [{ role: "assistant" as const, text: answer, voice: true, sources }] : [])])} onDraft={request => { setDraft(request); setPlan(undefined); }} onError={setError} /> : <form className="chat-composer" aria-label={tr("メッセージの入力")} onSubmit={event => { event.preventDefault(); ask(); }}>
      <textarea aria-label={tr("アシスタントへの質問")} aria-keyshortcuts="Control+Enter Meta+Enter" rows={2} required maxLength={4000} disabled={busy} value={text} onChange={event => setText(event.target.value)} placeholder={tr("質問や頼みたいことを入力…")} onKeyDown={event => submitOnShortcut(event)} />
      <div className="chat-composer-toolbar">
        <button type="submit" className="primary chat-send" disabled={busy || !text.trim()}>{tr("送信")}</button>
      </div>
    </form>}
  </section>;
}

const severityText = (value: PayPalSeverity) => ({ high: tr("緊急"), medium: tr("注意"), low: tr("確認") } satisfies Record<PayPalSeverity, string>)[value];
const kindText = (value: PayPalAlertKind) => ({
  refund_stalled: tr("返金の停滞"), awaiting_funds: tr("返金用残高の不足"), manual_review: tr("手動確認が必要"),
  capture_stalled: tr("決済が未確定"), state_mismatch: tr("台帳とPayPalの状態不一致"), unsold_slot: tr("割引枠の売れ残り"),
} satisfies Record<PayPalAlertKind, string>)[value];
const proposalOpText = (value: PayPalProposalOperation) => ({
  retry_refund: tr("返金の再試行"), resync: tr("状態の再同期"), complete_manual_review: tr("手動確認を完了にする"), close_transfer: tr("割引枠の再販を終了"),
} satisfies Record<PayPalProposalOperation, string>)[value];

function ProposalCard({ proposal, busy, owner, onExecute }: { proposal: PayPalProposal; busy: boolean; owner: boolean; onExecute: () => void }) {
  return <div className="paypal-proposal">
    <div><b>{proposalOpText(proposal.operation)}</b> <span>{proposal.target}</span></div>
    {proposal.amount !== undefined && proposal.currency && <p className="small">{tr("サーバーが計算した金額：{0}", paid(proposal.amount, proposal.currency))}</p>}
    <p className="small muted">{proposal.expected}</p>
    {owner && <button type="button" className="primary" disabled={busy} onClick={onExecute}>{tr("承認して実行")}</button>}
  </div>;
}

function AlertPanel({ alerts, checkResult, checking, busy, notify, digestHour, onNotify, onDigestHour, onSaveSettings, onCheck, onAsk, onExecute }: {
  alerts?: PayPalAlertState; checkResult?: PayPalAlertState; checking: boolean; busy: boolean; notify: boolean; digestHour: number;
  onNotify: (value: boolean) => void; onDigestHour: (value: number) => void; onSaveSettings: () => void;
  onCheck: () => void; onAsk: (question: string) => void; onExecute: (proposal: PayPalProposal) => void;
}) {
  const items: PayPalAlertItem[] = alerts?.items || [];
  const summary = !items.length ? tr("対応が必要な項目はありません。") : alerts?.locale === getLocale() && alerts.summary ? alerts.summary : tr("対応が必要な項目が{0}件あります。緊急{1}件、注意{2}件、確認{3}件です。", items.length, items.filter(item => item.severity === "high").length, items.filter(item => item.severity === "medium").length, items.filter(item => item.severity === "low").length);
  return <section className="paypal-alerts" aria-label={tr("PayPalの要対応")}>
    <div className="paypal-alerts-head">
      <h3>{tr("要対応")}{!!items.length && <span className="alert-badge">{items.length}</span>}</h3>
      <button type="button" disabled={checking || busy} onClick={onCheck}>{checking ? tr("確認しています…") : tr("今すぐチェック")}</button>
    </div>
    <p className="small muted">{summary}</p>
    {checkResult && <p className="small paypal-check-result" role="status">{tr("確認が完了しました。要対応：{0}件。", checkResult.items.length)} <time dateTime={checkResult.checkedAt}>{new Date(checkResult.checkedAt).toLocaleString(intlLocale())}</time></p>}
    {!!items.length && <ul className="paypal-alert-list">{items.map(item => <li key={item.id}>
      <div className="paypal-alert-row"><span className={`status ${item.severity}`}>{severityText(item.severity)}</span><b>{kindText(item.kind)}</b><span>{item.target}</span></div>
      <p className="small muted">{[item.bookingLabel, item.amount !== undefined && item.currency ? paid(item.amount, item.currency) : "", item.paypalId ? tr("PayPal ID: {0}", item.paypalId) : "", item.elapsedHours !== undefined ? tr("{0}時間経過", Math.round(item.elapsedHours * 10) / 10) : ""].filter(Boolean).join(" ・ ")}</p>
      <div className="actions"><button type="button" onClick={() => onAsk(tr("この記録について説明してください。予約ID: {0}、PayPal ID: {1}、種類: {2}", item.bookingId || tr("なし"), item.paypalId || tr("なし"), kindText(item.kind)))}>{tr("相談する")}</button></div>
      {item.proposal && <ProposalCard proposal={item.proposal} busy={busy} owner onExecute={() => onExecute(item.proposal!)} />}
    </li>)}</ul>}
    <details className="paypal-alert-settings">
      <summary>{tr("通知の設定")}</summary>
      <label><input type="checkbox" checked={notify} onChange={event => onNotify(event.target.checked)} /> {tr("メールで通知する")}</label>
      <label>{tr("ダイジェストの時刻")} <select value={digestHour} onChange={event => onDigestHour(Number(event.target.value))}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{tr("{0}時", hour)}</option>)}</select></label>
      <button type="button" disabled={busy} onClick={onSaveSettings}>{tr("通知設定を保存")}</button>
    </details>
  </section>;
}

/** Gemini Live voice: 16 kHz microphone PCM up, 24 kHz speech down, transcripts into the chat. */
function LiveVoice({ shopId, disabled, context, onTurn, onDraft, onError }: { shopId: string; disabled: boolean; context: () => { role: string; text: string }[]; onTurn: (question: string, answer: string, sources: Source[]) => void; onDraft: (request: string) => void; onError: (message: string) => void }) {
  const [state, setState] = useState<"off" | "connecting" | "on">("off");
  const [caption, setCaption] = useState("");
  const socket = useRef<WebSocket | undefined>(undefined);
  const connectionVersion = useRef(0);
  const stream = useRef<MediaStream | undefined>(undefined);
  const input = useRef<AudioContext | undefined>(undefined);
  const output = useRef<AudioContext | undefined>(undefined);
  const turnSources = useRef<Source[]>([]);
  const playAt = useRef(0);
  const sources = useRef(new Set<AudioBufferSourceNode>());
  const callbacks = useRef({ onTurn, onDraft, onError, context });
  callbacks.current = { onTurn, onDraft, onError, context };
  function silence() { for (const source of sources.current) source.stop(); sources.current.clear(); playAt.current = 0; }
  function stop() {
    connectionVersion.current++;
    socket.current?.close(); socket.current = undefined;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = undefined;
    void input.current?.close(); input.current = undefined;
    silence(); void output.current?.close(); output.current = undefined;
    turnSources.current = [];
    setState("off"); setCaption("");
  }
  useEffect(() => stop, []);
  useEffect(() => { if (disabled && state !== "off") stop(); }, [disabled]);
  async function start() {
    const version = ++connectionVersion.current;
    setState("connecting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(tr("この環境ではマイクを使えません。文字で質問してください。"));
      // Create playback inside the click so browsers allow audio.
      output.current = new AudioContext({ sampleRate: 24000 });
      await output.current.resume();
      if (version !== connectionVersion.current) return;
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (version !== connectionVersion.current) { microphone.getTracks().forEach(track => track.stop()); return; }
      stream.current = microphone;
      const context = new AudioContext({ sampleRate: 16000 });
      input.current = context;
      await context.audioWorklet.addModule("/live-audio.js");
      if (version !== connectionVersion.current) return;
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/shops/${shopId}/assistant/live`);
      socket.current = ws;
      const node = new AudioWorkletNode(context, "microphone");
      context.createMediaStreamSource(stream.current).connect(node);
      node.connect(context.destination);
      let ready = false;
      node.port.onmessage = event => {
        if (!ready || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 128000) return;
        const samples = event.data as Float32Array;
        const pcm = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-1, Math.min(1, samples[i])) * (samples[i] < 0 ? 32768 : 32767);
        let binary = "";
        for (const byte of new Uint8Array(pcm.buffer)) binary += String.fromCharCode(byte);
        ws.send(JSON.stringify({ type: "audio", data: btoa(binary) }));
      };
      ws.onmessage = event => {
        if (socket.current !== ws) return;
        const message = JSON.parse(event.data);
        if (message.type === "ready") {
          ready = true; setState("on"); setCaption(tr("質問をお話しください。"));
          const earlier = callbacks.current.context().slice(-6).map(item => ({ role: item.role, text: item.text.slice(-2000) }));
          if (earlier.length) ws.send(JSON.stringify({ type: "context", messages: earlier }));
        }
        if (message.type === "heard") setCaption(value => (value.startsWith("🎙") ? value : "🎙 ") + message.text);
        if (message.type === "spoken") setCaption(value => (value.startsWith("✳") ? value : "✳ ") + message.text);
        if (message.type === "sources") turnSources.current = [...turnSources.current, ...message.sources.filter((source: Source) => !turnSources.current.some(item => item.path === source.path))];
        if (message.type === "turn") { callbacks.current.onTurn(message.question, message.answer, turnSources.current); turnSources.current = []; setCaption(""); }
        if (message.type === "draft") callbacks.current.onDraft(message.text);
        if (message.type === "interrupted") silence();
        if (message.type === "error") callbacks.current.onError(message.message);
        if (message.type === "audio" && output.current) {
          const audio = output.current;
          const bytes = Uint8Array.from(atob(message.data), c => c.charCodeAt(0));
          const pcm = new Int16Array(bytes.buffer);
          const buffer = audio.createBuffer(1, pcm.length, Number(message.mimeType?.match(/rate=(\d+)/)?.[1] || 24000));
          const channel = buffer.getChannelData(0);
          for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
          const source = audio.createBufferSource();
          source.buffer = buffer; source.connect(audio.destination);
          const at = Math.max(audio.currentTime, playAt.current);
          source.start(at); playAt.current = at + buffer.duration;
          sources.current.add(source); source.onended = () => sources.current.delete(source);
        }
      };
      ws.onclose = event => { if (socket.current === ws) { stop(); if (event.code !== 1000 || event.reason) callbacks.current.onError(event.reason || tr("音声会話に接続できません。文字で質問してください。")); } };
    } catch (e) {
      if (version !== connectionVersion.current) return;
      stop();
      callbacks.current.onError(e instanceof Error ? e.message : String(e));
    }
  }
  return <div className="assistant-voice">
    <p className={`small muted assistant-voice-status${caption ? " assistant-caption" : ""}`} aria-live="polite">{caption || (state === "off" ? tr("開始ボタンを押して、AIに話しかけてください。") : state === "connecting" ? tr("接続しています…") : tr("お話しください。AIが声で答えます。"))}</p>
    <button type="button" className={state === "on" ? "primary" : ""} aria-pressed={state === "on"} disabled={disabled && state === "off"} onClick={() => state === "off" ? void start() : stop()}>
      {state === "off" ? tr("🎙 音声で話す") : state === "connecting" ? tr("接続しています…") : tr("■ 音声を終了")}
    </button>
  </div>;
}
