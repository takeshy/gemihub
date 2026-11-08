import { tr } from "../shared/i18n";
import type { OwnerIntegrationAlert } from "../server/integration-alerts";
import type { Workspace } from "./App";

const text = (alert: OwnerIntegrationAlert) => {
  if (alert.kind === "reconnect") return alert.type === "drive"
    ? tr("Googleとの接続を確認してください。Google Driveへの保存用コピーの更新が止まっています。")
    : tr("Googleとの接続を確認してください。お客様へのメール送信が止まっています。");
  if (alert.kind === "inquiry_failed") return tr("この返信メールを送信できませんでした。返信内容は記録に残っています。宛先と添付ファイルを確認してください。");
  if (alert.kind === "drive_delay") return tr("Google Driveへの保存用コピーの更新が遅れています。自動で再試行しています。");
  return tr("お客様へのメール送信が遅れています。自動で再試行しています。急ぎの連絡は、電話など別の方法でお願いします。");
};

export function IntegrationAttention({ shop, open }: { shop: Workspace; open: (screen: string, recordId?: string) => void }) {
  const alerts = shop.integrationAlerts || [];
  if (!alerts.length) return null;
  return <section className="panel integration-alerts" aria-label={tr("Google連携の要対応")}>
    <h2>{tr("Google連携の要対応")}<span className="alert-badge">{alerts.length}</span></h2>
    <ul>
      {alerts.map(alert => <li key={alert.id}>
        <p>{text(alert)}</p>
        {alert.affectedCount > 1 && <p className="small muted">{tr("{0}件の処理に影響しています。", alert.affectedCount)}</p>}
        {alert.kind === "reconnect" && <a className="button primary" href={`/auth/google?shop=${encodeURIComponent(shop.slug)}`}>{tr("Googleに再接続する")}</a>}
        {alert.kind === "inquiry_failed" && alert.inquiryId && <button type="button" onClick={() => open("inquiries", alert.inquiryId)}>{tr("問い合わせを確認する")}</button>}
      </li>)}
    </ul>
  </section>;
}
