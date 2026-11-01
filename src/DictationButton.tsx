import React, { useEffect, useRef, useState } from "react";
type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void; abort(): void; onresult: ((event: { resultIndex: number; results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } } }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null };
export function DictationButton({ disabled, onText, onListening }: { disabled?: boolean; onText: (text: string) => void; onListening?: (listening: boolean) => void }) {
  const recognition = useRef<Recognition | null>(null);
  const callback = useRef(onText); callback.current = onText;
  const listeningCallback = useRef(onListening); listeningCallback.current = onListening;
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { const rec = recognition.current; if (rec) { rec.onresult = rec.onerror = rec.onend = null; rec.abort(); } listeningCallback.current?.(false); }, []);
  function toggle() {
    if (listening) { recognition.current?.stop(); return; }
    const win = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Speech = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!Speech) { setError("このブラウザでは音声入力を利用できません。文字で入力してください。"); return; }
    setError("");
    const rec = new Speech(); recognition.current = rec;
    rec.lang = "ja-JP"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = event => {
      const text = Array.from({ length: event.results.length - event.resultIndex }, (_, i) => event.results[event.resultIndex + i]).filter(result => result.isFinal).map(result => result[0].transcript).join(" ");
      if (text) callback.current(text);
    };
    rec.onend = () => { setListening(false); listeningCallback.current?.(false); };
    rec.onerror = () => { setListening(false); listeningCallback.current?.(false); setError("音声を聞き取れませんでした。マイクの許可を確認するか、文字で続けてください。"); };
    try { rec.start(); setListening(true); listeningCallback.current?.(true); } catch { setError("音声入力を開始できませんでした。"); }
  }
  return <span className="dictation"><button type="button" disabled={disabled && !listening} onClick={toggle}>{listening ? "音声入力を止める" : "音声で指示する"}</button>{error && <span role="alert">{error}</span>}</span>;
}
