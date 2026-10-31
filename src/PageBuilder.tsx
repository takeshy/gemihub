import React, { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useApi } from "./api";
import { pageSchema, type ShopPage } from "../server/pages";
import { PageEditor } from "./PageEditor";
import { createRequestId } from "./request-id";
import { CustomPage } from "./CustomPage";
const messageSchema = z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(12000) });
const pageDraftSchema = z.object({ id: z.string(), slug: z.string(), title: z.string(), navigationLabel: z.string(), body: z.string(), layout: z.enum(["standard", "compact"]), imageUrl: z.string() });
const savedSchema = z.object({ mode: z.enum(["chat", "write"]), messages: z.array(messageSchema).max(40), text: z.string().max(12000), candidate: pageDraftSchema.optional() });
type SpeechSession = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((event: { results: { [index: number]: { [index: number]: { transcript: string } } } }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
};
export function PageBuilder({ shopId, email, onAdd }: { shopId: string; email: string; onAdd: (page: ShopPage) => void }) {
  const api = useApi();
  const key = `omaiweb:page-builder:${email}:${shopId}`;
  const [mode, setMode] = useState<"chat" | "write">("chat");
  const [messages, setMessages] = useState<z.infer<typeof messageSchema>[]>([]);
  const [text, setText] = useState("");
  const [candidate, setCandidate] = useState<ShopPage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechSession | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    try { const raw = localStorage.getItem(key); if (raw) { const data = savedSchema.parse(JSON.parse(raw)); setMode(data.mode); setMessages(data.messages); setText(data.text); setCandidate(data.candidate); } } catch { setError("作成中の会話を復元できませんでした。"); }
    setLoaded(true);
    alive.current = true;
    return () => { alive.current = false; recognition.current?.abort(); window.speechSynthesis?.cancel(); };
  }, [key]);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(key, JSON.stringify({ mode, messages, text, candidate })); } catch { setError("作成中の内容をこのブラウザに保存できませんでした。"); }
  }, [key, mode, messages, text, candidate, loaded]);
  async function send(input = text, speak = false) {
    if (!input.trim() || busy) return;
    setBusy(true); setError("");
    const history = mode === "write" ? [{ role: "user" as const, text: input }] : [...messages, { role: "user" as const, text: input }];
    if (history.length > 38) { setBusy(false); setError("会話が長くなりました。要望をまとめて「要望を書いて作る」から続けてください。"); return; }
    try {
      const reply = await api<{ reply: string; page: Omit<ShopPage, "id"> | null }>(`/api/shops/${shopId}/pages/create-with-ai`, { messages: history, mode });
      const nextMessages = [...history, { role: "assistant" as const, text: reply.reply }];
      const nextCandidate = reply.page ? pageSchema.parse({ ...reply.page, id: candidate?.id || createRequestId() }) : undefined;
      localStorage.setItem(key, JSON.stringify({ mode, messages: nextMessages, text: "", candidate: nextCandidate }));
      if (!alive.current) return;
      setMessages(nextMessages); setText(""); setCandidate(nextCandidate);
      if (speak && window.speechSynthesis) { const voice = new SpeechSynthesisUtterance(reply.reply); voice.lang = "ja-JP"; window.speechSynthesis.cancel(); window.speechSynthesis.speak(voice); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  function talk() {
    const speechWindow = window as unknown as { SpeechRecognition?: new () => SpeechSession; webkitSpeechRecognition?: new () => SpeechSession };
    const Speech = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Speech) { setError("このブラウザでは音声入力を利用できません。文字で会話を続けてください。"); return; }
    window.speechSynthesis?.cancel();
    const rec = new Speech(); recognition.current = rec; rec.lang = "ja-JP"; rec.continuous = false; rec.interimResults = false;
    rec.onresult = (event) => { const transcript = String(event.results[0][0].transcript); setText(transcript); void send(transcript, true); };
    rec.onerror = () => { setListening(false); setError("音声を取得できませんでした。マイクの許可を確認するか、文字で続けてください。"); };
    rec.onend = () => setListening(false);
    try { rec.start(); setListening(true); } catch { setError("音声入力を開始できませんでした。"); }
  }
  return <section className="panel page-builder">
    <h2>ページをつくる</h2><p>AIと会話するか、作りたいページの要望を書いてください。案を確認してローカルの画面ツリーに追加します。本番にはまだ公開しません。</p>
    <div className="actions"><button className={mode === "chat" ? "primary" : ""} disabled={busy || listening} onClick={() => setMode("chat")}>AIと話しながら作る</button><button className={mode === "write" ? "primary" : ""} disabled={busy || listening} onClick={() => setMode("write")}>要望を書いて作る</button></div>
    {error && <p className="alert" role="alert">{error}</p>}
    {mode === "chat" && <div className="page-conversation" aria-live="polite">{!messages.length && <p>どんなページが必要ですか？目的、載せたい内容、雰囲気から教えてください。</p>}{messages.map((m, i) => <p key={i}><b>{m.role === "user" ? "あなた" : "AI"}</b><br />{m.text}</p>)}</div>}
    <label>{mode === "chat" ? "AIへの返答・相談" : "作りたいページの要望"}<textarea disabled={busy || listening} rows={5} maxLength={12000} value={text} onChange={e => setText(e.target.value)} placeholder="例：初めてのお客様向けのFAQを、やさしい雰囲気で作りたいです。予約方法、持ち物、キャンセルについて載せたいです。" /></label>
    <div className="actions"><button className="primary" disabled={busy || listening || !text.trim()} onClick={() => void send()}>{busy ? "AIが考えています…" : mode === "chat" ? "AIに相談する" : "ページ案を作る"}</button>{mode === "chat" && <button disabled={busy} onClick={() => { if (listening) recognition.current?.stop(); else talk(); }}>{listening ? "音声入力を止める" : "音声で話す"}</button>}</div>
    {mode === "write" && messages.at(-1)?.role === "assistant" && <p className="notice">{messages.at(-1)!.text}</p>}
    {candidate && <div className="page-proposal"><h3>ページ案を確認</h3><p>必要なら直してからツリーに追加できます。</p><PageEditor page={candidate} onChange={setCandidate} onDelete={() => setCandidate(undefined)} /><CustomPage page={candidate} /><button className="primary" disabled={busy || listening} onClick={() => { try { const checked = pageSchema.parse(candidate); onAdd(checked); localStorage.removeItem(key); setCandidate(undefined); setMessages([]); setText(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>この案を画面ツリーに追加</button></div>}
  </section>;
}
