import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Loader2, LogOut } from "lucide-react";
import { useI18n } from "~/i18n/context";
import { BlueskyIcon } from "~/components/bluesky/BlueskyIcon";
import { useBlueskyConnection, webBluesky } from "~/services/bluesky-client";
import { Label, SectionCard } from "./shared";

type Notice = { kind: "success" | "error"; text: string } | null;

/** Connect the Bluesky account that Timeline posts are published with. */
export function BlueskyTab() {
  const { language } = useI18n();
  const ja = language === "ja";
  const connection = useBlueskyConnection();
  const [handle, setHandle] = useState("");
  const [connecting, setConnecting] = useState<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const connectingRef = useRef(connecting);
  connectingRef.current = connecting;
  // Leaving the settings abandons a pending authorization.
  useEffect(() => () => connectingRef.current?.abort(), []);

  const connect = async () => {
    const controller = new AbortController();
    setConnecting(controller);
    setNotice(null);
    try {
      await webBluesky.connect(handle.trim(), controller.signal);
      const status = await webBluesky.status();
      setNotice({ kind: "success", text: ja ? `Bluesky に接続しました: ${status.handle || status.did}` : `Connected to Bluesky as ${status.handle || status.did}` });
      setHandle("");
    } catch (caught) {
      if (!controller.signal.aborted) setNotice({ kind: "error", text: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setConnecting(null);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await webBluesky.disconnect();
      setNotice({ kind: "success", text: ja ? "Bluesky との接続を解除しました" : "Disconnected from Bluesky" });
    } catch (caught) {
      setNotice({ kind: "error", text: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setBusy(false);
    }
  };

  const button = "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50";

  return (
    <SectionCard>
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 text-sky-500"><BlueskyIcon size={20} /></span>
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Bluesky</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {ja
              ? "接続すると Timeline の投稿に Bluesky ボタンが表示されます。会話から投稿を選び、それぞれテキストか画像（Timeline での見た目のまま）で公開できます。接続は Bluesky の認可画面で行い、パスワードを GemiHub に入力することはありません。"
              : "Once connected, Timeline posts show a Bluesky button. Pick posts of a conversation and publish each as text or as an image of how it looks in the Timeline. You authorize on Bluesky's own screen; your password is never entered in GemiHub."}
          </p>
        </div>
      </div>

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mb-4 flex items-center gap-2 rounded-md border p-3 text-sm ${
            notice.kind === "success"
              ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
          }`}
        >
          {notice.kind === "success" ? <Check size={16} /> : <AlertCircle size={16} />}
          {notice.text}
        </div>
      )}

      {connection === null ? (
        <Loader2 size={16} className="animate-spin text-gray-400" />
      ) : connection.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-800">
          <div className="min-w-0">
            <div className="text-xs text-gray-500 dark:text-gray-400">{ja ? "接続中のアカウント" : "Connected account"}</div>
            <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">@{connection.handle || connection.did}</div>
          </div>
          <button type="button" disabled={busy} onClick={() => void disconnect()} className={`${button} border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800`}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
            {ja ? "接続を解除" : "Disconnect"}
          </button>
        </div>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); if (handle.trim() && !connecting) void connect(); }}>
          <Label htmlFor="bluesky-handle">{ja ? "Bluesky のハンドル" : "Bluesky handle"}</Label>
          <div className="flex flex-wrap gap-2">
            <input
              id="bluesky-handle"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="alice.bsky.social"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              disabled={!!connecting}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
            {connecting ? (
              <button type="button" onClick={() => connecting.abort()} className={`${button} border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800`}>
                <Loader2 size={16} className="animate-spin" />
                {ja ? "キャンセル" : "Cancel"}
              </button>
            ) : (
              <button type="submit" disabled={!handle.trim()} className={`${button} bg-blue-600 text-white hover:bg-blue-700`}>
                <BlueskyIcon size={16} />
                {ja ? "Bluesky と接続" : "Connect Bluesky"}
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {connecting
              ? (ja ? "開いたウィンドウの Bluesky の画面で接続を許可してください。" : "Authorize the connection on Bluesky in the window that opened.")
              : (ja ? "Bluesky の認可画面が新しいウィンドウで開きます。" : "Opens Bluesky's authorization screen in a new window.")}
          </p>
        </form>
      )}
    </SectionCard>
  );
}
