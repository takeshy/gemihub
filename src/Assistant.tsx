import { tr } from "../shared/i18n";
import React, { useEffect, useRef, useState } from "react";
import { useApi } from "./api";
import { submitOnShortcut } from "./submit-shortcut";
import { type Plan, type Workspace } from "./App";
import { ScreenGallery } from "./ScreenGallery";
import { AssistantAnswer } from "./AssistantAnswer";
import { ProposalCard, proposalOpText } from "./PayPalAttention";
import type { PayPalProposal } from "../server/paypal-ops";
import "./Assistant.css";
import { savedAssistantSchema, assistantStorageKey } from "./assistant-storage";
import { createRequestId } from "./request-id";
import type { ShopChat } from "../server/shop-chat";

type Source = { path: string; title: string };
type Reply = { answer: string; sources: Source[]; request?: string; paypalProposals?: PayPalProposal[] };
type Message = { role: "user" | "assistant"; text: string; sources?: Source[]; voice?: boolean };


/**
 * The shop assistant: questions answered from spec.md, history.md and the system OKF bundle.
 * A change request becomes an editable draft; approving it creates an ordinary change plan,
 * which is reviewed and applied exactly like other plans.
 */
export function Assistant({ shop, voice, userEmail, acceptPlan, reload, conversationId, initialQuestion, onInitialQuestionConsumed, onConversationChange }: { conversationId?: string; initialQuestion?: string; onInitialQuestionConsumed?: () => void; onConversationChange?: () => void; shop: Workspace; voice: boolean; userEmail: string; acceptPlan: (plan: Plan) => Promise<void>; reload: () => Promise<unknown> }) {
  const api = useApi();
  const storageKey = assistantStorageKey(shop.id, userEmail, conversationId);
  const [saved] = useState(() => { try { return savedAssistantSchema.parse(JSON.parse(localStorage.getItem(storageKey) || "null")); } catch { return undefined; } });
  const [messages, setMessages] = useState<Message[]>(saved?.messages || []);
  const [text, setText] = useState(saved?.text || "");
  const [mode, setMode] = useState<"chat" | "voice">("chat");
  const voiceMode = voice && mode === "voice";
  const [busy, setBusy] = useState(!!conversationId);
  const [loaded, setLoaded] = useState(!conversationId);
  const [loadRetry, setLoadRetry] = useState(0);
  const [conversationTitle, setConversationTitle] = useState("");
  const pending = useRef<{id:string;text:string} | undefined>(saved?.pending);
  const consumedInitial = useRef(false);
  const lastReplyId = useRef("");
  const [dismissedRequestId, setDismissedRequestId] = useState(saved?.dismissedRequestId);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<string|undefined>(saved?.draft);
  const [plan, setPlan] = useState<Plan|undefined>(()=>shop.plans.find(plan=>plan.id===saved?.planId&&plan.base===shop.revision&&!plan.approved));
  const [proposals, setProposals] = useState<PayPalProposal[]>([]);
  const log = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { try { localStorage.setItem(storageKey,JSON.stringify({messages:messages.slice(-100),text,draft,planId:plan?.id,dismissedRequestId,pending:pending.current})); } catch { /* Storage may be unavailable in private browsing. */ } },[storageKey,messages,text,draft,plan?.id,dismissedRequestId]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages.length, draft, plan?.id]);
  useEffect(() => {
    if (!conversationId) return;
    let active = true; setBusy(true); setLoaded(false); setError("");
    void api<ShopChat>(`/api/shops/${shop.id}/conversations/${conversationId}`).then(chat => {
      if (!active) return;
      if (chat.intent !== "consult") throw new Error(tr("チャットが見つかりません"));
      setConversationTitle(chat.title);
      setMessages(chat.messages.map(message => ({role:message.role,text:message.text,sources:message.detail.consultation?.sources,voice:message.detail.voice})));
      const last = chat.messages.at(-1);
      const reply = chat.messages.filter(message => message.role === "assistant").at(-1);
      if (reply) { lastReplyId.current = reply.requestId; setProposals(reply.detail.consultation?.paypalProposals || []); if (!saved?.draft && !saved?.planId && saved?.dismissedRequestId !== reply.requestId) setDraft(reply.detail.consultation?.request); }
      if (saved?.pending && chat.messages.some(message => message.role === "assistant" && message.requestId === saved.pending!.id) && saved.text === saved.pending.text) { setText(""); pending.current = undefined; }
      if (last?.role === "user") { pending.current = {id:last.requestId,text:last.text}; if (!saved?.text.trim()) setText(last.text.slice(0,4000)); }
      setLoaded(true);
    }).catch(error => { if (active) { setMessages([]); setError(error instanceof Error ? error.message : String(error)); } }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [shop.id, conversationId, loadRetry]);
  useEffect(() => {
    if (!initialQuestion || !loaded || busy || consumedInitial.current) return;
    consumedInitial.current = true; ask(initialQuestion); onInitialQuestionConsumed?.();
  }, [initialQuestion, loaded, busy]);
  async function saveTurn(question: string, answer: string, sources: Source[] = [], voice = false) {
    if (conversationId) await api(`/api/shops/${shop.id}/conversations/${conversationId}/turns`, {requestId:createRequestId(),question,answer,sources,voice});
    onConversationChange?.();
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)); } finally { if (alive.current) setBusy(false); }
  }
  const history = () => messages.slice(-12).map(({ role, text }) => ({ role, text: text.slice(0, 4000) }));
  function ask(question = text) {
    const value = question.trim();
    if (!value || busy || !loaded) return;
    void run(async () => {
      const earlier = history();
      const requestId = pending.current?.text === value ? pending.current.id : createRequestId();
      const retrying = pending.current?.text === value; pending.current = {id:requestId,text:value};
      setMessages(items => retrying && items.at(-1)?.role === "user" && items.at(-1)?.text === value ? items : [...items, { role: "user", text: value }]);
      setText("");
      if (!messages.some(message => message.role === "user")) setConversationTitle(value.replace(/\s+/g," ").slice(0,60));
      try {
        const reply = await api<Reply>(`/api/shops/${shop.id}/assistant`, { question: value, messages: earlier, ...(conversationId ? {chat:{id:conversationId,requestId}} : {}) });
        if (!alive.current) return;
        setMessages(items => [...items, { role: "assistant", text: reply.answer, sources: reply.sources }]);
        pending.current = undefined; lastReplyId.current = requestId;
        setProposals(reply.paypalProposals || []);
        if (reply.request) { setDraft(reply.request); setPlan(undefined); }
      } catch (e) { setText(value); throw e; } finally { onConversationChange?.(); }
    });
  }
  const executeProposal = (proposal: PayPalProposal) => run(async () => {
    try {
      const result = await api<{ ok: boolean; error?: string }>(`/api/shops/${shop.id}/paypal/proposals/execute`, {
        proposalId: proposal.id, alertId: proposal.alertId, fingerprint: proposal.fingerprint,
      });
      if (!result.ok) throw new Error(result.error || tr("状態が変わっています。最新の状態を確認してください。"));
    } catch (error) {
      setProposals([]);
      await reload().catch(() => {});
      throw error;
    }
    setProposals(items => items.filter(item => item.id !== proposal.id));
    const resultText = tr("実行しました：{0}。最新の状態を表示しています。", proposalOpText(proposal.operation));
    setMessages(items => [...items, { role: "assistant", text: resultText }]);
    await reload();
    await saveTurn("", resultText);
  });
  const approveDraft = () => run(async () => {
    const next = await api<Plan>(`/api/shops/${shop.id}/plan`, { text: draft, intent: "modify" });
    if (!alive.current) return;
    setPlan(next); setDraft(undefined); setDismissedRequestId(lastReplyId.current);
  });
  return <section className="panel assistant" aria-labelledby="assistant-title">
    <div className="section-top"><span className="ai-mark">✳</span><div>
      <h2 id="assistant-title">{tr("相談・質問")}</h2>
      <p className="small muted">{tr("使い方や現在のお店の設定について質問できます。見た目の修正は「AIとお店をつくる」の各画面、ページ追加や機能の変更は「ページ追加・機能変更」で依頼できます。")}</p>
    </div></div>
    {conversationTitle && <h3 className="assistant-conversation-title">{conversationTitle}</h3>}
    {conversationId && !loaded && error && <button type="button" disabled={busy} onClick={() => setLoadRetry(value => value + 1)}>{tr("もう一度読み込む")}</button>}
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
        <button type="button" disabled={busy} onClick={() => { setDraft(undefined); setDismissedRequestId(lastReplyId.current); }}>{tr("破棄する")}</button>
        {shop.isOwner && <button type="button" className="primary" disabled={busy || !draft?.trim()} onClick={() => void approveDraft()}>{tr("承認して変更プランを作る")}</button>}
      </div>
    </section>}
    {plan && <section className="request-review" aria-label={tr("変更案の確認")}>
      <h3>{tr("このように変更してよいですか？")}</h3>
      <ul className="check-list">{plan.summary.map((summary, index) => <li key={index}>{summary}</li>)}</ul>
      <ScreenGallery key={plan.id} config={plan.config} previousConfig={shop.published || undefined} shopId={shop.id} />
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => setPlan(undefined)}>{tr("やめる")}</button>
        <button type="button" className="primary" disabled={busy} onClick={() => void run(async () => { await acceptPlan(plan); if (alive.current) { setPlan(undefined); setMessages(items => [...items, { role: "assistant", text: tr("変更を反映しました。変更履歴に依頼文とあわせて記録しました。") }]); } })}>{tr("この内容で反映する")}</button>
      </div>
    </section>}
    {voiceMode ? <LiveVoice shopId={shop.id} disabled={busy} context={history} onTurn={(question, answer, sources) => { setMessages(items => [...items, ...(question ? [{ role: "user" as const, text: question, voice: true }] : []), ...(answer ? [{ role: "assistant" as const, text: answer, voice: true, sources }] : [])]); void saveTurn(question, answer, sources, true).catch(error => { if (alive.current) setError(error instanceof Error ? error.message : String(error)); }); }} onDraft={request => { setDraft(request); setPlan(undefined); }} onError={setError} /> : <form className="chat-composer" aria-label={tr("メッセージの入力")} onSubmit={event => { event.preventDefault(); ask(); }}>
      <textarea aria-label={tr("アシスタントへの質問")} aria-keyshortcuts="Control+Enter Meta+Enter" rows={2} required maxLength={4000} disabled={busy || !loaded} value={text} onChange={event => setText(event.target.value)} placeholder={tr("質問や頼みたいことを入力…")} onKeyDown={event => submitOnShortcut(event)} />
      <div className="chat-composer-toolbar">
        <button type="submit" className="primary chat-send" disabled={busy || !loaded || !text.trim()}>{tr("送信")}</button>
      </div>
    </form>}
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
