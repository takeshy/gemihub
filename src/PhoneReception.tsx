import { useEffect, useState } from "react";
import { tr } from "../shared/i18n";
import { useApi } from "./api";
import { defaultPhoneSettings, type PhoneSettings } from "../shared/phone";
import type { Workspace } from "./App";

const weekdays = () => [tr("日"), tr("月"), tr("火"), tr("水"), tr("木"), tr("金"), tr("土")];
const outcomeLabel = (outcome?: string) => ({ booking: tr("予約"), inquiry: tr("お問い合わせ"), cancelled: tr("キャンセル"), answered: tr("応答"), blocked: tr("非通知"), closed: tr("時間外"), error: tr("エラー"), ended: tr("終了") } as Record<string, string>)[outcome || ""] || outcome || "-";

export function PhoneReception({ shop, reload }: { shop: Workspace; reload: () => Promise<unknown> }) {
  const api = useApi();
  const [settings, setSettings] = useState<PhoneSettings>(shop.phoneSettings || defaultPhoneSettings);
  const [useHours, setUseHours] = useState(!!(shop.phoneSettings || defaultPhoneSettings).hours);
  const [calls, setCalls] = useState<{ id: string; at: string; outcome?: string; transcript?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { const next = shop.phoneSettings || defaultPhoneSettings; setSettings(next); setUseHours(!!next.hours); }, [shop.id, shop.phoneSettings]);
  useEffect(() => {
    let cancelled = false;
    void api<{ calls: { id: string; at: string; outcome?: string; transcript?: string }[] }>(`/api/shops/${shop.id}/phone/calls`)
      .then(data => { if (!cancelled) setCalls(data.calls); })
      .catch(() => { /* calls are optional in the settings view */ });
    return () => { cancelled = true; };
  }, [shop.id]);
  const hours = settings.hours;
  const changeHours = (value: Partial<NonNullable<PhoneSettings["hours"]>>) => setSettings({
    ...settings,
    hours: { start: hours?.start || "09:00", end: hours?.end || "18:00", ...hours, ...value },
  });
  return <section className="phone-reception-settings" aria-label={tr("AI電話受付")}>
    <h3>{tr("AI電話受付")}</h3>
    <p className="small muted">{tr("電話に出られない時間に、AIが予約・問い合わせを受け付けます。予約は来店時の現金払いで、オンラインと同じ空き枠に入ります。")}</p>
    {error && <p className="alert" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <label className="checkbox"><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} />{tr("AI電話受付を有効にする")}</label>
    <label>{tr("Twilioの電話番号（E.164）")}<input value={settings.twilioNumber} placeholder="+819012345678" onChange={event => setSettings({ ...settings, twilioNumber: event.target.value })} /></label>
    <label className="checkbox"><input type="checkbox" checked={settings.cashBookings} onChange={event => setSettings({ ...settings, cashBookings: event.target.checked })} />{tr("電話で現金の当日予約を受け付ける")}</label>
    <p className="small muted">{tr("前払いを使う店では今日の残り枠だけ、前払いを使わない店では予約可能期間内の任意の日を受け付けます。当日分の譲渡枠は、来店がなかった場合の返金額が店負担になることを確認してから提示します。")}</p>
    <fieldset>
      <legend>{tr("AIが応答する時間帯")}</legend>
      <label className="checkbox"><input type="checkbox" checked={useHours} onChange={event => { setUseHours(event.target.checked); if (event.target.checked) changeHours({}); else setSettings({ ...settings, hours: undefined }); }} />{tr("時間帯を指定する（指定しない場合は常に応答）")}</label>
      {useHours && <>
        <label>{tr("開始")}<input type="time" value={hours?.start || "09:00"} onChange={event => changeHours({ start: event.target.value })} /></label>
        <label>{tr("終了")}<input type="time" value={hours?.end || "18:00"} onChange={event => changeHours({ end: event.target.value })} /></label>
        <div className="checkboxes">{weekdays().map((label, day) => <label key={day}><input type="checkbox" checked={!hours?.weekdays || hours.weekdays.includes(day)} onChange={event => changeHours({ weekdays: (hours?.weekdays || [0, 1, 2, 3, 4, 5, 6]).filter(value => value !== day).concat(event.target.checked ? [day] : []).sort() })} />{label}</label>)}</div>
      </>}
    </fieldset>
    <div className="actions">
      <button className="primary" disabled={busy} onClick={async () => {
        setBusy(true); setError(""); setNotice("");
        try {
          const parsed = { ...settings, twilioNumber: settings.twilioNumber.trim(), ...(settings.greeting ? { greeting: settings.greeting.trim() } : {}) };
          if (!useHours) delete parsed.hours;
          const result = await api<{ settings: PhoneSettings }>(`/api/shops/${shop.id}/phone/settings`, parsed);
          setSettings(result.settings); await reload(); setNotice(tr("電話受付の設定を保存しました。"));
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
      }}>{busy ? tr("保存しています…") : tr("電話受付の設定を保存")}</button>
      <button type="button" disabled={busy} onClick={() => { setSettings({ ...defaultPhoneSettings }); setUseHours(false); setNotice(tr("初期値に戻しました。保存すると反映されます。")); }}>{tr("初期値に戻す")}</button>
    </div>
    {!!calls.length && <details><summary>{tr("最近の電話（7日間）")}</summary>
      <ul className="phone-calls">{calls.slice(0, 20).map(call => <li key={call.id}><time>{new Date(call.at).toLocaleString()}</time> <span className="pill">{outcomeLabel(call.outcome)}</span>{call.transcript && <p className="small muted">{call.transcript.slice(0, 300)}</p>}</li>)}</ul>
    </details>}
  </section>;
}
