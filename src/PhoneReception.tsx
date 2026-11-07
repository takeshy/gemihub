import { useEffect, useRef, useState } from "react";
import { tr } from "../shared/i18n";
import { useApi } from "./api";
import { defaultPhoneSettings, type PhoneSettings, type PhoneRulesProposal } from "../shared/phone";
import { createRequestId } from "./request-id";
import type { Workspace } from "./App";

const weekdays = () => [tr("日"), tr("月"), tr("火"), tr("水"), tr("木"), tr("金"), tr("土")];
const outcomeLabel = (outcome?: string) => ({ booking: tr("予約"), inquiry: tr("お問い合わせ"), cancelled: tr("キャンセル"), answered: tr("応答"), blocked: tr("非通知"), closed: tr("時間外"), error: tr("エラー"), ended: tr("終了") } as Record<string, string>)[outcome || ""] || outcome || "-";

export function PhoneReception({ shop, reload }: { shop: Workspace; reload: () => Promise<unknown> }) {
  const api = useApi();
  const [settings, setSettings] = useState<PhoneSettings>(shop.phoneSettings || defaultPhoneSettings);
  const [source, setSource] = useState<PhoneSettings>(shop.phoneSettings || defaultPhoneSettings);
  const [useHours, setUseHours] = useState(!!(shop.phoneSettings || defaultPhoneSettings).hours);
  const [calls, setCalls] = useState<{ id: string; at: string; callId?: string; outcome?: string; transcript?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [aiOpen, setAiOpen] = useState(false), [note, setNote] = useState("");
  const [callId, setCallId] = useState<string>();
  const [proposal, setProposal] = useState<PhoneRulesProposal>();
  const aiRequest = useRef<{ input: string; id: string } | undefined>(undefined);
  const generation = useRef(0);
  useEffect(() => {
    const next = shop.phoneSettings || defaultPhoneSettings;
    setSettings(next); setSource(next); setUseHours(!!next.hours);
    setProposal(undefined); setAiOpen(false); setNote(""); setCallId(undefined); aiRequest.current = undefined;
    generation.current++;
    return () => { generation.current++; };
  }, [shop.id, shop.phoneSettings]);
  useEffect(() => {
    let cancelled = false;
    setCalls([]);
    void api<{ calls: typeof calls }>(`/api/shops/${shop.id}/phone/calls`)
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
    <fieldset disabled={busy || !!proposal}>
    <label className="checkbox"><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} />{tr("AI電話受付を有効にする")}</label>
    <label>{tr("Twilioの電話番号（E.164）")}<input value={settings.twilioNumber} placeholder="+819012345678" onChange={event => setSettings({ ...settings, twilioNumber: event.target.value })} /></label>
    <label className="checkbox"><input type="checkbox" checked={settings.cashBookings} onChange={event => setSettings({ ...settings, cashBookings: event.target.checked })} />{tr("電話で現金の当日予約を受け付ける")}</label>
    <p className="small muted">{tr("前払いを使う店では今日の残り枠だけ、前払いを使わない店では予約可能期間内の任意の日を受け付けます。当日分の譲渡枠は電話では扱いません。")}</p>
    <fieldset>
      <legend>{tr("AIが応答する時間帯")}</legend>
      <label className="checkbox"><input type="checkbox" checked={useHours} onChange={event => { setUseHours(event.target.checked); if (event.target.checked) changeHours({}); else setSettings({ ...settings, hours: undefined }); }} />{tr("時間帯を指定する（指定しない場合は常に応答）")}</label>
      {useHours && <>
        <label>{tr("開始")}<input type="time" value={hours?.start || "09:00"} onChange={event => changeHours({ start: event.target.value })} /></label>
        <label>{tr("終了")}<input type="time" value={hours?.end || "18:00"} onChange={event => changeHours({ end: event.target.value })} /></label>
        <div className="checkboxes">{weekdays().map((label, day) => <label key={day}><input type="checkbox" checked={!hours?.weekdays || hours.weekdays.includes(day)} onChange={event => changeHours({ weekdays: (hours?.weekdays || [0, 1, 2, 3, 4, 5, 6]).filter(value => value !== day).concat(event.target.checked ? [day] : []).sort() })} />{label}</label>)}</div>
      </>}
    </fieldset>
    <label>{tr("電話AIの応対ルール")}<textarea rows={7} maxLength={6000} value={settings.rules || ""} onChange={event => { setSettings({ ...settings, rules: event.target.value }); setNotice(""); }} placeholder={tr("例：オフの希望は当店・他店を確認する。対応できない組み合わせは希望を記録して折り返しを案内する。")} /></label>
    <p className="small muted">{tr("話し方・確認事項・困ったときの対応を設定できます。保存すると次の電話から使われます。料金・空き枠・追加メニューの対応関係は、お店に登録された設定が優先されます。")}</p>
    </fieldset>
    <button type="button" disabled={busy} aria-expanded={aiOpen} onClick={() => { setAiOpen(!aiOpen); setProposal(undefined); }}>{tr("AIでルールを改善")}</button>
    {aiOpen && <section className="settings-ai" aria-label={tr("電話AIのルールを改善")}>
      <p>{tr("現在のルールと依頼から改善案を作ります。最近の電話を選ぶと、その通話も参考にできます。入力欄に反映し、保存するまで電話の対応は変わりません。")}</p>
      {callId && <p className="small">{tr("選択した通話を参考にします。")}{" "}<button type="button" disabled={busy} onClick={() => { setCallId(undefined); setProposal(undefined); }}>{tr("通話の選択を解除")}</button></p>}
      <label>{tr("ルールの改善依頼")}<textarea rows={4} maxLength={4000} disabled={busy} value={note} onChange={event => { setNote(event.target.value); setProposal(undefined); }} placeholder={tr("例：今回の予約エラーを防げるように、追加メニューの確認手順を改善して。ほかのルールは残して。")} /></label>
      <button type="button" disabled={busy || !note.trim()} onClick={async () => {
        const version = generation.current;
        setBusy(true); setError(""); setNotice(""); setProposal(undefined);
        try {
          const input = { note: note.trim(), rules: settings.rules || "", ...(callId ? { callId } : {}) }, key = JSON.stringify(input);
          if (aiRequest.current?.input !== key) aiRequest.current = { input: key, id: createRequestId() };
          const result = await api<PhoneRulesProposal>(`/api/shops/${shop.id}/phone/rules/ai`, { ...input, requestId: aiRequest.current.id });
          if (version !== generation.current) return;
          setProposal(result); aiRequest.current = undefined;
        } catch (e) { if (version === generation.current) setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
      }}>{busy ? tr("改善案を作成しています…") : tr("改善案を作る")}</button>
      {proposal && <div className="settings-ai-review">
        <h4>{tr("ルールの改善案を確認")}</h4><p>{proposal.explanation}</p>
        <dl><div className="settings-ai-change"><dt>{tr("電話AIの応対ルール")}</dt><dd><span>{tr("現在")}</span>{settings.rules || tr("未設定")}</dd><dd><span>{tr("改善案")}</span>{proposal.rules || tr("未設定")}</dd></div></dl>
        {!!proposal.warnings.length && <ul className="settings-ai-warnings">{proposal.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        <div className="actions"><button type="button" className="primary" disabled={busy} onClick={() => { setSettings({ ...settings, rules: proposal.rules }); setProposal(undefined); setNotice(tr("入力欄に反映しました。内容を確認し、「保存」でお店に反映してください。")); }}>{tr("入力欄に反映")}</button>
          <button type="button" disabled={busy} onClick={() => setProposal(undefined)}>{tr("案を破棄")}</button></div>
      </div>}
    </section>}
    <div className="actions">
      <button className="primary" disabled={busy || !!proposal} onClick={async () => {
        setBusy(true); setError(""); setNotice("");
        try {
          const parsed = { ...settings, rules: settings.rules || "", twilioNumber: settings.twilioNumber.trim(), ...(settings.greeting ? { greeting: settings.greeting.trim() } : {}) };
          if (!useHours) delete parsed.hours;
          const result = await api<{ settings: PhoneSettings }>(`/api/shops/${shop.id}/phone/settings`, { ...parsed, previous: source });
          setSettings(result.settings); setSource(result.settings); await reload(); setNotice(tr("電話受付の設定を保存しました。"));
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
      }}>{busy ? tr("保存しています…") : tr("電話受付の設定を保存")}</button>
      <button type="button" disabled={busy || !!proposal} onClick={() => { setSettings({ ...defaultPhoneSettings, rules: "" }); setUseHours(false); setNotice(tr("初期値に戻しました。保存すると反映されます。")); }}>{tr("初期値に戻す")}</button>
      {error && <button type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        try { const latest = await api<PhoneSettings>(`/api/shops/${shop.id}/phone/settings`); setSettings(latest); setSource(latest); setUseHours(!!latest.hours); setProposal(undefined); setError(""); setNotice(tr("保存済みの設定を確認しました。")); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
      }}>{tr("最新の設定を読み込む")}</button>}
    </div>
    {!!calls.length && <details><summary>{tr("最近の電話（7日間）")}</summary>
      <ul className="phone-calls">{calls.slice(0, 20).map(call => <li key={call.id}><time>{new Date(call.at).toLocaleString()}</time> <span className="pill">{outcomeLabel(call.outcome)}</span>{call.transcript && <details><summary>{tr("通話記録を見る")}</summary><p className="phone-transcript small muted">{call.transcript}</p></details>}{call.callId && <button type="button" disabled={busy} onClick={() => { setCallId(call.callId); setAiOpen(true); setProposal(undefined); setNote(tr("この通話でうまく対応できなかった点を改善するルールを追加して。ほかのルールは残して。")); }}>{tr("この通話からルールを改善")}</button>}</li>)}</ul>
    </details>}
  </section>;
}
