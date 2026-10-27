import React, { useEffect, useRef, useState } from "react";
import { useApi } from "./api";
const labels: Record<string, string> = {
  name: "店名",
  industry: "業種",
  menus: "メニュー・所要時間・料金",
  staff: "スタッフ・対応メニュー・勤務",
  hours: "営業時間",
  closed: "定休日・臨時休業",
  rules: "予約ルール",
  notificationEmail: "通知メール",
  changes: "変更したいこと",
};
type Interview = { fields: Record<string, string>; version: number };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((event: {
        results: {
          length: number;
          [i: number]: {
            isFinal: boolean;
            [i: number]: { transcript: string };
          };
        };
        resultIndex: number;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
export function VoiceInput({
  shopId,
  onText,
  onPlan,
  disabled,
  published = false,
}: {
  shopId: string;
  onText: (text: string) => void;
  onPlan?: (text: string) => Promise<void>;
  disabled?: boolean;
  published?: boolean;
}) {
  const api = useApi();
  const [state, setState] = useState<Interview>({ fields: {}, version: 0 });
  const [mode, setMode] = useState<"live" | "speech" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const alive = useRef(true);
  const generation = useRef(0);
  const connectionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const ws = useRef<WebSocket | undefined>(undefined);
  const stream = useRef<MediaStream | undefined>(undefined);
  const inputAudio = useRef<AudioContext | undefined>(undefined);
  const processor = useRef<AudioWorkletNode | undefined>(undefined);
  const playback = useRef<AudioContext | undefined>(undefined);
  const playAt = useRef(0);
  const sources = useRef(new Set<AudioBufferSourceNode>());
  const recognition = useRef<Recognition | undefined>(undefined);
  const queue = useRef(Promise.resolve());
  const saving = useRef<Promise<Interview> | undefined>(undefined);
  const callbacks = useRef({ onText, onPlan });
  callbacks.current = { onText, onPlan };
  const prefix = `/api/shops/${shopId}`;
  function silence() {
    for (const source of sources.current) source.stop();
    sources.current.clear();
    playAt.current = 0;
  }
  function stop() {
    generation.current++;
    clearTimeout(connectionTimer.current);
    ws.current?.close();
    ws.current = undefined;
    const rec = recognition.current;
    recognition.current = undefined;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.abort();
    }
    processor.current?.disconnect();
    processor.current = undefined;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = undefined;
    void inputAudio.current?.close();
    inputAudio.current = undefined;
    silence();
    void playback.current?.close();
    playback.current = undefined;
    if (alive.current) {
      setMode(null);
      setPending(false);
      setInterim("");
    }
  }
  useEffect(() => {
    alive.current = true;
    void api<Interview>(prefix + "/interview")
      .then((s) => {
        if (alive.current) setState(s);
      })
      .catch((e) => {
        if (alive.current) setError(e.message);
      });
    return () => {
      alive.current = false;
      stop();
    };
  }, [shopId]);
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);
  function showError(e: unknown) {
    if (alive.current) setError(e instanceof Error ? e.message : String(e));
  }
  function acceptPlan(text: string) {
    stop();
    if (callbacks.current.onPlan)
      void callbacks.current.onPlan(text).catch(showError);
    else callbacks.current.onText(text);
  }
  async function live() {
    stop();
    setError("");
    setPending(true);
    const attempt = generation.current;
    connectionTimer.current = setTimeout(() => {
      if (attempt === generation.current) {
        stop();
        showError(
          new Error(
            "音声会話への接続に時間がかかっています。再開するか文字入力をご利用ください。",
          ),
        );
      }
    }, 20000);
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "この環境ではマイクを使えません。文字で会話を続けられます。",
        );
      // Create/resume playback in the user's gesture before waiting for permission/network.
      playback.current = new AudioContext({ sampleRate: 24000 });
      await playback.current.resume();
      const input = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!alive.current || attempt !== generation.current) {
        input.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = input;
      const context = new AudioContext({ sampleRate: 16000 });
      inputAudio.current = context;
      await context.audioWorklet.addModule("/live-audio.js");
      await context.resume();
      if (!alive.current || attempt !== generation.current) {
        void context.close();
        input.getTracks().forEach((t) => t.stop());
        return;
      }
      const socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${prefix}/live`,
      );
      ws.current = socket;
      const node = new AudioWorkletNode(context, "microphone");
      processor.current = node;
      context.createMediaStreamSource(input).connect(node);
      node.connect(context.destination);
      let ready = false;
      node.port.onmessage = (e) => {
        if (
          !ready ||
          socket.readyState !== WebSocket.OPEN ||
          socket.bufferedAmount > 128000
        )
          return;
        const samples = e.data as Float32Array;
        const pcm = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++)
          pcm[i] =
            Math.max(-1, Math.min(1, samples[i])) *
            (samples[i] < 0 ? 32768 : 32767);
        const bytes = new Uint8Array(pcm.buffer);
        let binary = "";
        for (const b of bytes) binary += String.fromCharCode(b);
        socket.send(JSON.stringify({ type: "audio", data: btoa(binary) }));
      };
      socket.onmessage = (e) => {
        if (!alive.current || attempt !== generation.current) return;
        try {
          const event = JSON.parse(e.data);
          if (event.type === "ready") {
            clearTimeout(connectionTimer.current);
            ready = true;
            setMode("live");
            setPending(false);
            setQuestion("お店のことをお話しください。");
          }
          if (event.type === "reconnecting") {
            ready = false;
            setQuestion("会話をつなぎ直しています…");
          }
          if (event.type === "state") setState(event.state);
          if (event.type === "transcript")
            setInterim((v) => (v + event.text).slice(-4000));
          if (event.type === "question")
            setQuestion((v) => (v + event.text).slice(-4000));
          if (event.type === "error") setError(event.message);
          if (event.type === "plan") acceptPlan(event.text);
          if (event.type === "interrupted") silence();
          if (event.type === "audio" && playback.current) {
            const context = playback.current;
            const binary = atob(event.data);
            const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
            const pcm = new Int16Array(bytes.buffer);
            const rate = Number(
              event.mimeType?.match(/rate=(\d+)/)?.[1] || 24000,
            );
            const buffer = context.createBuffer(1, pcm.length, rate);
            const channel = buffer.getChannelData(0);
            for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(context.destination);
            const start = Math.max(context.currentTime, playAt.current);
            source.start(start);
            playAt.current = start + buffer.duration;
            sources.current.add(source);
            source.onended = () => sources.current.delete(source);
          }
        } catch {
          setError("音声の応答を読み取れませんでした。");
        }
      };
      socket.onerror = () => {
        if (attempt === generation.current) {
          stop();
          showError(
            new Error(
              "音声会話に接続できません。リアルタイム書き起こしか文字入力をご利用ください。",
            ),
          );
        }
      };
      socket.onclose = () => {
        if (attempt === generation.current) {
          stop();
          showError(
            new Error(
              "音声会話を終了しました。確定済みの項目から再開できます。",
            ),
          );
        }
      };
    } catch (e) {
      if (attempt === generation.current) {
        stop();
        showError(e);
      }
    }
  }
  function turn(text: string) {
    callbacks.current.onText(text);
    const attempt = generation.current;
    queue.current = queue.current.then(async () => {
      if (!alive.current || attempt !== generation.current) return;
      setPending(true);
      try {
        const result = await api<{
          state: Interview;
          question: string;
          text?: string;
        }>(prefix + "/interview/turn", { text });
        if (!alive.current || attempt !== generation.current) return;
        setState(result.state);
        setQuestion(result.question);
        if (result.text) acceptPlan(result.text);
      } catch (e) {
        showError(e);
      } finally {
        if (alive.current && attempt === generation.current) setPending(false);
      }
    });
  }
  function speech() {
    stop();
    setError("");
    const Constructor =
      (
        window as unknown as {
          SpeechRecognition?: new () => Recognition;
          webkitSpeechRecognition?: new () => Recognition;
        }
      ).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => Recognition })
        .webkitSpeechRecognition;
    if (!Constructor) {
      setError(
        "このブラウザはリアルタイム書き起こしに対応していません。文字で入力してください。",
      );
      return;
    }
    const rec = new Constructor();
    recognition.current = rec;
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) turn(result[0].transcript);
        else text += result[0].transcript;
      }
      setInterim(text);
    };
    rec.onerror = (e) => {
      stop();
      setError(
        e.error === "not-allowed"
          ? "マイクの使用を許可するか、文字で入力してください。"
          : "音声を聞き取れませんでした。再開するか文字で入力してください。",
      );
    };
    rec.onend = () => {
      if (recognition.current === rec) {
        recognition.current = undefined;
        setMode(null);
        setInterim("");
      }
    };
    try {
      rec.start();
      setMode("speech");
    } catch (e) {
      stop();
      showError(e);
    }
  }
  async function edit(field: string, value: string) {
    try {
      saving.current = api<Interview>(prefix + "/interview", {
        fields: { [field]: value },
        version: state.version,
      });
      setState(await saving.current);
    } catch (e) {
      showError(e);
      try {
        setState(await api<Interview>(prefix + "/interview"));
      } catch {}
    }
  }
  async function reviewFields() {
    stop();
    setPending(true);
    setError("");
    try {
      const saved = await saving.current;
      const version = Math.max(state.version, saved?.version || 0);
      const result = await api<{ state: Interview; text: string }>(
        prefix + "/interview/plan",
        { fields: state.fields, version },
      );
      if (alive.current) {
        setState(result.state);
        acceptPlan(result.text);
      }
    } catch (e) {
      showError(e);
    } finally {
      if (alive.current) setPending(false);
    }
  }
  return (
    <div className="voice-input">
      <div className="actions">
        <button
          type="button"
          disabled={disabled}
          onClick={mode || pending ? stop : live}
        >
          {mode
            ? "会話を止める"
            : pending
              ? "処理を中止する"
              : "🎙 AI と音声で話す"}
        </button>
        <button
          type="button"
          disabled={disabled || pending || !!mode}
          onClick={speech}
        >
          リアルタイム書き起こし
        </button>
      </div>
      <p className="small muted">
        話した内容は順に下へ反映します。いつでも文字で直せます。プランの承認と公開は画面で行います。
      </p>
      {question && <p role="status">{question}</p>}
      {interim && (
        <p className="small" aria-live="polite">
          {interim}
        </p>
      )}
      <div className="actions">
        <input
          aria-label="会話への返答"
          value={typed}
          disabled={disabled || !!mode}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={
            published ? "変更したいことを入力" : "質問への返答を入力"
          }
        />
        <button
          type="button"
          disabled={disabled || pending || !!mode || !typed.trim()}
          onClick={() => {
            turn(typed);
            setTyped("");
          }}
        >
          会話に送る
        </button>
      </div>
      <details open={Object.keys(state.fields).length > 0}>
        <summary>聞き取ったお店の情報（修正できます）</summary>
        {Object.entries(labels)
          .filter(([key]) =>
            published
              ? key === "changes" || !!state.fields[key]
              : key !== "changes",
          )
          .map(([key, label]) => (
            <label key={key}>
              {label}
              <textarea
                aria-label={`確認：${label}`}
                value={state.fields[key] || ""}
                disabled={disabled}
                onChange={(e) =>
                  setState((v) => ({
                    ...v,
                    fields: { ...v.fields, [key]: e.target.value },
                  }))
                }
                onBlur={(e) => void edit(key, e.target.value)}
                rows={2}
              />
            </label>
          ))}
      </details>
      {Object.keys(state.fields).length > 0 && (
        <button
          type="button"
          disabled={disabled || pending}
          onClick={() => void reviewFields()}
        >
          この内容でプランを確認 →
        </button>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
