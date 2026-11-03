import React, { useRef, useState } from "react";
import { tr } from "../shared/i18n";
import { useApi } from "./api";

export function ShopReset({ shopId, navigate, showButton = true }: { shopId: string; navigate: (href: string) => void; showButton?: boolean }) {
  const api = useApi();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await api("/api/shop-reset", { shopId });
      // Only remove drafts for this shop; language and other shops' work stay intact.
      try {
        for (const key of Object.keys(localStorage))
          if (key.startsWith("gemihub:") && key.split(":").includes(shopId)) localStorage.removeItem(key);
      } catch { /* A storage restriction must not prevent returning to the first screen. */ }
      dialog.current?.close();
      navigate("/");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <>
    {showButton && <button className="text-button" onClick={() => { setError(""); dialog.current?.showModal(); }}>{tr("自分のお店を初期化")}</button>}
    <dialog ref={dialog} className="shop-reset-dialog" aria-labelledby="shop-reset-title" aria-describedby="shop-reset-description" onCancel={event => { if (busy) event.preventDefault(); }}>
      <h2 id="shop-reset-title">{tr("お店を最初から作り直しますか？")}</h2>
      <p id="shop-reset-description">{tr("自分のお店の公開ページを閉じ、設定・予約・問い合わせ・お客様・記事・画像・AIとの会話を初期化します。元に戻せません。")}</p>
      <p>{tr("Google連携は維持します。お店専用のDriveフォルダはゴミ箱に移動し、次のお店の保存先を新しく用意します。")}</p>
      <p className="small muted">{tr("PayPalの決済・返金履歴は残ります。初期化による返金は行いません。")}</p>
      {error && <p className="alert" role="alert">{error}<br />{tr("初期化をもう一度押すと、同じ処理を続けます。")}</p>}
      <div className="actions">
        <button autoFocus disabled={busy} onClick={() => dialog.current?.close()}>{tr("やめる")}</button>
        <button className="danger" disabled={busy} onClick={submit}>{busy ? tr("初期化しています…") : tr("初期化して最初からつくる")}</button>
      </div>
    </dialog>
  </>;
}
