import React, { useEffect, useState, useRef, useId } from "react";
import { useApi } from "./api";
import { tr } from "../shared/i18n";
import { couponRuleSchema, couponRuleIssues, couponTemplate, couponTemplateIds, couponTemplateLabel, manualCouponSchema, couponConditionLabel, couponScheduleLabel, couponDiscountLabel, type CouponRule, type CouponCampaign, type CouponWalletItem } from "../shared/coupons";
import { currencyOf, regionOf, dateIn, type Currency } from "../shared/region";
import type { ShopConfig } from "../server/domain";
import { createRequestId } from "./request-id";
import { DateInput } from "./DateInput";
import { useShopDisplay } from "./money";

export const defaultCoupon = (): CouponRule => couponTemplate("first", "");
export function Coupons({ shopId, config }: { shopId: string; config: ShopConfig }) {
  const api = useApi(), base = `/api/shops/${shopId}/coupons`, currency = currencyOf(regionOf(config));
  const [campaigns, setCampaigns] = useState<CouponCampaign[]>(), [issued, setIssued] = useState(0), [rule, setRule] = useState<CouponRule>(defaultCoupon), [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [requestId, setRequestId] = useState(createRequestId);
  const [proposing, setProposing] = useState(false), [proposalError, setProposalError] = useState("");
  const proposalRequest = useRef<AbortController | null>(null);
  function cancelProposal() {
    const controller = proposalRequest.current;
    proposalRequest.current = null;
    controller?.abort();
    setProposing(false);
  }
  useEffect(() => {
    setProposing(false); setProposalError("");
    return () => { proposalRequest.current?.abort(); proposalRequest.current = null; };
  }, [shopId]);
  async function propose() {
    if (proposalRequest.current || busy || !request.trim()) return;
    const controller = new AbortController();
    proposalRequest.current = controller;
    setProposing(true); setProposalError(""); setError(""); setNotice("");
    // The browser also bounds the entire request, including transport and JSON parsing.
    const timer = setTimeout(() => {
      if (proposalRequest.current !== controller) return;
      cancelProposal();
      setProposalError(tr("クーポン案の作成が時間切れになりました。もう一度試すか、下の項目から手入力で作成してください。"));
    }, 35000);
    try {
      const result = await api<{ rule: CouponRule | null; question: string }>(`${base}/propose`, { request }, { signal: controller.signal });
      if (proposalRequest.current !== controller) return;
      if (!result.rule) { setNotice(result.question); return; }
      const parsed = couponRuleSchema.safeParse(result.rule);
      if (!parsed.success) throw new Error(tr("クーポン案を作成できませんでした。もう一度お試しください。"));
      setRule(parsed.data); setRequestId(createRequestId());
      setNotice(tr("AIの案を下の項目で確認・編集してください。まだ配布は有効になっていません。"));
    } catch (e) {
      if (proposalRequest.current === controller) setProposalError(e instanceof Error ? e.message : tr("操作できませんでした"));
    } finally {
      clearTimeout(timer);
      if (proposalRequest.current === controller) { proposalRequest.current = null; setProposing(false); }
    }
  }
  const [customers,setCustomers] = useState<{email:string;name:string}[]>([]);
  const load = async () => { const result = await api<{ campaigns: CouponCampaign[]; issued: number; customers?: {email:string;name:string}[] }>(base); setCampaigns(result.campaigns); setIssued(result.issued); setCustomers(result.customers || []); };
  const run = async (fn: () => Promise<void>) => { setError(""); setNotice(""); setBusy(true); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : tr("操作できませんでした")); } finally { setBusy(false); } };
  useEffect(() => { void run(load); }, [shopId]);
  const [mode, setMode] = useState<"list" | "create" | "manual">("list");
  const [focusVersion, setFocusVersion] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null), feedback = useRef<HTMLParagraphElement>(null), saving = useRef(false);
  const conditionErrorId = useId(), scheduleErrorId = useId();
  const issues = couponRuleIssues(rule);
  useEffect(() => { if (focusVersion) { heading.current?.focus(); heading.current?.scrollIntoView({ block: "start" }); } }, [mode, focusVersion]);
  useEffect(() => { if (notice) { feedback.current?.focus(); feedback.current?.scrollIntoView({ block: "nearest" }); } }, [notice]);
  function show(next: typeof mode) { cancelProposal(); setProposalError(""); setError(""); setNotice(""); setMode(next); setFocusVersion(v => v + 1); }
  function create() { setRule(defaultCoupon()); setRequest(""); setRequestId(createRequestId()); show("create"); }
  function change(value: Partial<CouponRule>) { cancelProposal(); setProposalError(""); setRule(current => ({ ...current, ...value })); setRequestId(createRequestId()); setNotice(""); }

  return <section className="panel coupon-management">
    <h2>{tr("クーポン")}</h2>
    <p>{tr("条件と付与タイミングを決めると、該当する会員に自動で配布します。お客様はマイページで確認し、予約時に1枚選んで使えます。")}</p>
    {error && <div role="alert" className="alert">{error}<button disabled={busy} onClick={() => void run(load)}>{tr("再読み込み")}</button></div>}
    {notice && <p ref={feedback} tabIndex={-1} role="status" className="notice coupon-feedback">{notice}</p>}
    <nav className="coupon-actions" aria-label={tr("クーポンの操作")}>
      <button disabled={busy} aria-pressed={mode === "list"} onClick={() => show("list")}>{tr("配布中・停止中のクーポン")}</button>
      <button disabled={busy} aria-pressed={mode === "create"} onClick={create}>{tr("新しく作る")}</button>
      <button disabled={busy} aria-pressed={mode === "manual"} onClick={() => show("manual")}>{tr("手動付与")}</button>
    </nav>
    <h3 className="coupon-workspace-title" ref={heading} tabIndex={-1}>{mode === "list" ? tr("配布中・停止中のクーポン") : mode === "create" ? tr("クーポンを作る") : tr("お客様を選んで手動付与")}</h3>
    <div hidden={mode !== "manual"}><ManualCoupons key={shopId} base={base} currency={currency} customers={customers} reload={load} onBusyChange={setBusy}/></div>
    {mode === "create" && <section className="coupon-create">
    <div className="coupon-templates"><span>{tr("用途からはじめる")}</span>{couponTemplateIds.map(template => <button type="button" key={template} disabled={busy} onClick={() => change(couponTemplate(template, dateIn(new Date(), regionOf(config).timeZone)))}>{couponTemplateLabel(template)}</button>)}</div>
    <fieldset disabled={busy}>
      <legend>{tr("AIにクーポンを依頼")}</legend>
      <label className="field"><span>{tr("作りたいクーポン")}</span><textarea value={request} maxLength={4000} onChange={e => { cancelProposal(); setProposalError(""); setRequest(e.target.value); }} placeholder={tr("例：誕生日月の会員に毎月1日9時に20%引き、30日間有効。来店5回ごとに500円引き。11月10日の一周年に会員全員へ10%引き。")}/></label>
      <button type="button" disabled={proposing || !request.trim()} onClick={() => void propose()}>{tr("クーポン案を作る")}</button>
      {proposing && <div className="coupon-proposal-progress">
        <p role="status"><span className="image-upload-spinner" aria-hidden="true"/>{tr("AIがクーポン案を作成しています…（最大35秒）")}</p>
        <button type="button" onClick={() => { cancelProposal(); setNotice(tr("クーポン案の作成を中止しました。")); }}>{tr("作成を中止")}</button>
      </div>}
      {proposalError && <div role="alert" className="alert">{proposalError}<button type="button" disabled={!request.trim()} onClick={() => void propose()}>{tr("もう一度試す")}</button></div>}
    </fieldset>
    <form onSubmit={e => {
      e.preventDefault(); if (saving.current || proposalRequest.current) return;
      void run(async () => {
        const result = couponRuleSchema.safeParse(rule);
        if (!result.success) throw new Error(tr("クーポンの入力内容を確認してください"));
        if (issues.length) throw new Error(issues[0].message);
        saving.current = true;
        try {
          await api(base, { requestId, rule: result.data });
          setMode("list"); setNotice(tr("クーポンの自動配布を有効にしました。"));
          await load();
        } finally { saving.current = false; }
      });
    }}>
      <fieldset disabled={busy}>
        <legend>{tr("配布内容を確認")}</legend>
        <label className="field"><span>{tr("クーポン名")}</span><input required maxLength={100} value={rule.title} onChange={e => change({ title: e.target.value })}/></label>
        <DiscountFields currency={currency} discount={rule.discount} validDays={rule.validDays} onDiscount={discount => change({ discount })} onValidDays={validDays => change({ validDays })}/>
        <label className="field"><span>{tr("条件の組み合わせ")}</span><select aria-invalid={issues.some(i => i.field === "conditions")} aria-describedby={issues.some(i => i.field === "conditions") ? conditionErrorId : undefined} aria-label={tr("条件の組み合わせ")} value={rule.match} onChange={e => change({ match: e.target.value as "all" | "any" })}><option value="all">{tr("すべての条件を満たす")}</option><option value="any">{tr("いずれかの条件を満たす")}</option></select></label>
        {rule.conditions.map((condition, index) => <div className="coupon-condition" key={index}>
          <label className="field"><span>{tr("配布条件 {0}", index + 1)}</span><select aria-label={tr("配布条件 {0}",index+1)} value={condition.type} onChange={e => change({ conditions: rule.conditions.map((c, i) => i === index ? e.target.value === "visit_count" ? { type: "visit_count", count: 5, comparison: "exact" } : { type: e.target.value as "everyone" | "first_visit" | "birthday_month" } : c) })}>{["everyone", "first_visit", "birthday_month", "visit_count"].map(type => <option key={type} value={type}>{type === "visit_count" ? tr("来店回数") : couponConditionLabel({ type } as CouponRule["conditions"][number])}</option>)}</select></label>
          {condition.type === "visit_count" && <>
            <label className="field"><span>{tr("回数")}</span><input type="number" required min={1} max={10000} value={condition.count} onChange={e => change({ conditions: rule.conditions.map((c, i) => i === index ? { ...condition, count: Number(e.target.value) } : c) })}/></label>
            <label className="field"><span>{tr("回数の条件")}</span><select aria-label={tr("回数の条件")} value={condition.comparison} onChange={e => change({ conditions: rule.conditions.map((c, i) => i === index ? { ...condition, comparison: e.target.value as "exact" | "multiple" | "at_least" } : c) })}><option value="exact">{tr("ちょうどこの回数")}</option><option value="multiple">{tr("この回数ごと")}</option><option value="at_least">{tr("この回数以上")}</option></select></label>
          </>}
          {rule.conditions.length > 1 && <button type="button" onClick={() => change({ conditions: rule.conditions.filter((_, i) => i !== index) })}>{tr("条件を外す")}</button>}
        </div>)}
        {issues.some(i => i.field === "conditions") && <p className="alert" role="alert" id={conditionErrorId}>{issues.find(i => i.field === "conditions")!.message}</p>}
        <button type="button" disabled={rule.conditions.length >= 10} onClick={() => change({ conditions: [...rule.conditions, { type: "birthday_month" }] })}>{tr("条件を追加")}</button>
        <label className="field"><span>{tr("付与計算のタイミング")}</span><select aria-invalid={issues.some(i => i.field === "schedule")} aria-describedby={issues.some(i => i.field === "schedule") ? scheduleErrorId : undefined} aria-label={tr("付与計算のタイミング")} value={rule.schedule.type} onChange={e => change({ schedule: e.target.value === "monthly" ? { type: "monthly", day: 1, hour: 9 } : e.target.value === "once" ? { type: "once", date: "", hour: 9 } : { type: e.target.value as "registration" | "after_visit" } })}><option value="registration">{couponScheduleLabel({ type: "registration" })}</option><option value="after_visit">{couponScheduleLabel({ type: "after_visit" })}</option><option value="monthly">{tr("毎月")}</option><option value="once">{tr("指定日（一周年記念など）")}</option></select></label>
        {issues.some(i => i.field === "schedule") && <p className="alert" role="alert" id={scheduleErrorId}>{issues.find(i => i.field === "schedule")!.message}</p>}
        {rule.schedule.type === "monthly" && <label className="field"><span>{tr("毎月の日付（存在しない日は月末）")}</span><input type="number" min={1} max={31} required value={rule.schedule.day} onChange={e => { if (rule.schedule.type === "monthly") change({ schedule: { ...rule.schedule, day: Number(e.target.value) } }); }}/></label>}
        {rule.schedule.type === "once" && <label className="field"><span>{tr("配布日")}</span><DateInput aria-label={tr("配布日")} value={rule.schedule.date} onValueChange={date => { if (rule.schedule.type === "once") change({ schedule: { ...rule.schedule, date } }); }}/></label>}
        {(rule.schedule.type === "once" || rule.schedule.type === "monthly") && <label className="field"><span>{tr("配布時刻（店舗時間・時）")}</span><input type="number" min={0} max={23} required value={rule.schedule.hour} onChange={e => { if (rule.schedule.type === "once" || rule.schedule.type === "monthly") change({ schedule: { ...rule.schedule, hour: Number(e.target.value) } }); }}/></label>}
        <p className="small muted">{tr("来店回数は終了した有効な予約だけで計算します。取消・無断キャンセルは含みません。無断キャンセルの記録を待つため、予約終了の24時間後に来店として数えます。来店後のクーポンは次回以降に使えます。1予約に1枚使えます。通常キャンセルが確定した場合は、有効期限内のクーポンを再利用できます。無断キャンセルでは戻りません。")}</p>
        <button type="submit" disabled={issues.length > 0 || proposing} className="primary">{tr("この内容で自動配布を有効にする")}</button>
      </fieldset>
    </form>
    </section>}
    {mode === "list" && <section className="coupon-campaigns">
    <p>{tr("付与済み {0}枚", issued)}</p>
    {campaigns?.length === 0 && <p className="empty-coupons">{tr("まだ自動配布のクーポンはありません。「新しく作る」から始めてください。")}</p>}
    {!campaigns && <p role="status">{tr("読み込み中…")}</p>}
    {campaigns?.map(c => <article className="booking-card" key={c.id}><div><h3>{c.title} · {couponDiscountLabel(c.discount, c.currency)}</h3><p>{c.conditions.map(couponConditionLabel).join(c.match === "all" ? " ＆ " : " / ")}</p><p>{couponScheduleLabel(c.schedule)} · {tr("有効期間 {0}日", c.validDays)}</p><p>{!c.enabled ? tr("配布停止中") : c.currency === currency ? tr("自動配布中") : tr("お店の通貨と異なるため配布できません")}</p></div><button disabled={busy} onClick={() => void run(async () => { await api(`${base}/${c.id}/enabled`, { enabled: !c.enabled }); await load(); })}>{c.enabled ? tr("配布を停止") : tr("配布を再開")}</button></article>)}
    <p className="small muted">{tr("停止しても配布済みのクーポンは有効期限まで使えます。再開しても、停止中の来店や配布日の分はさかのぼって配布しません。毎分自動計算し、同じ対象期間・来店について二重に付与しません。")}</p>
    <button disabled={busy} onClick={() => void run(async () => { await api(`${base}/calculate`, {}); await load(); setNotice(tr("現在の条件で付与を計算しました。")); })}>{tr("今すぐ付与を計算")}</button>
    </section>}
  </section>;
}

function DiscountFields({ currency, discount, validDays, onDiscount, onValidDays }: { currency: Currency; discount: CouponRule["discount"]; validDays: number; onDiscount: (discount: CouponRule["discount"]) => void; onValidDays: (days: number) => void }) {
  const whole = discount.type === "percent" || currency === "JPY";
  return <div className="coupon-fields">
    <label className="field"><span>{tr("割引の種類")}</span><select aria-label={tr("割引の種類")} value={discount.type} onChange={e => onDiscount({ type: e.target.value as "percent" | "amount", value: e.target.value === "percent" ? 10 : currency === "JPY" ? 500 : 5 })}><option value="percent">{tr("割引率（%）")}</option><option value="amount">{tr("割引金額（{0}）", currency)}</option></select></label>
    <label className="field"><span>{tr("割引の値")}</span><input type="number" required min={whole ? 1 : 0.01} max={discount.type === "percent" ? 100 : 1000000} step={whole ? 1 : 0.01} value={discount.value} onChange={e => onDiscount({ ...discount, value: Number(e.target.value) })}/></label>
    <label className="field"><span>{tr("付与からの有効日数")}</span><input type="number" required min={1} max={365} value={validDays} onChange={e => onValidDays(Number(e.target.value))}/></label>
  </div>;
}

function ManualCoupons({base,currency,customers,reload,onBusyChange}:{base:string;currency:Currency;customers:{email:string;name:string}[];reload:()=>Promise<void>;onBusyChange:(busy:boolean)=>void}) {
  const api=useApi();
  const [title,setTitle]=useState(()=>tr("手動クーポン")),[discount,setDiscount]=useState<CouponRule["discount"]>({type:"percent",value:10}),[validDays,setValidDays]=useState(30),[selected,setSelected]=useState<string[]>([]),[query,setQuery]=useState("");
  const [requestId,setRequestId]=useState(createRequestId),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const changed=()=>{setRequestId(createRequestId());setNotice("");};
  const visible=customers.filter(c=>`${c.name} ${c.email}`.toLowerCase().includes(query.toLowerCase()));
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (notice || error) { feedback.current?.focus(); feedback.current?.scrollIntoView({block:"nearest"}); } }, [notice,error]);
  return <section className="manual-coupons">
    <p>{tr("自動配布の条件を使わず、選んだ会員に1枚ずつ付与します。")}</p>
    {(error||notice)&&<p ref={feedback} tabIndex={-1} role={error?"alert":"status"} className={error?"alert":"notice"}>{error||notice}</p>}
    <form onSubmit={event=>{event.preventDefault();setBusy(true);onBusyChange(true);setError("");setNotice("");void(async()=>{try{
      const input=manualCouponSchema.safeParse({requestId,title,discount,validDays,customers:selected});if(!input.success)throw new Error(tr("付与先とクーポンの内容を確認してください。"));
      const result=await api<{count:number}>(`${base}/manual`,input.data);await reload();setNotice(tr("{0}人にクーポンを付与しました。",result.count));setSelected([]);setRequestId(createRequestId());
    }catch(e){setError(e instanceof Error?e.message:tr("操作できませんでした"));}finally{setBusy(false);onBusyChange(false);}})();}}>
      <fieldset disabled={busy}><legend>{tr("手動付与の内容")}</legend>
        <label className="field"><span>{tr("クーポン名")}</span><input required maxLength={100} value={title} onChange={e=>{setTitle(e.target.value);changed();}}/></label>
        <DiscountFields currency={currency} discount={discount} validDays={validDays} onDiscount={value=>{setDiscount(value);changed();}} onValidDays={value=>{setValidDays(value);changed();}}/>
        <label className="field"><span>{tr("付与先を名前・メールで検索")}</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
        <button type="button" onClick={()=>{setSelected(current=>[...new Set([...current,...visible.map(c=>c.email)])]);changed();}}>{tr("表示中の会員をすべて選ぶ")}</button>
        <button type="button" onClick={()=>{setSelected([]);changed();}}>{tr("選択を解除")}</button>
        <div className="manual-coupon-members" role="group" aria-label={tr("付与する会員")}>{visible.map(c=><label key={c.email}><input type="checkbox" checked={selected.includes(c.email)} onChange={e=>{setSelected(current=>e.target.checked?[...current,c.email]:current.filter(email=>email!==c.email));changed();}}/>{c.name} · {c.email}</label>)}</div>
        <div className="manual-coupon-selection">
          <p aria-live="polite">{tr("選択中 {0}人",selected.length)}</p>
          <ul className="selected-recipients" aria-label={tr("選択済みのお客様")}>{selected.map(email => <li key={email}><span>{customers.find(c => c.email === email)?.name || email} · {email}</span><button type="button" aria-label={tr("{0}の選択を解除",email)} onClick={() => { setSelected(current => current.filter(value => value !== email)); changed(); }}>{tr("外す")}</button></li>)}</ul>
          <button className="primary" type="submit" disabled={!selected.length}>{tr("選んだ{0}人に付与する",selected.length)}</button>
        </div>
      </fieldset>
    </form>
  </section>;
}

export function CouponWallet({ items, config, onUse }: { items: CouponWalletItem[]; config: ShopConfig; onUse?: (id:string)=>void }) {
  const { shopTime } = useShopDisplay(regionOf(config));
  if (!items.length) return null;
  const states = { available: tr("利用可能"), reserved: tr("支払い手続き中"), used: tr("使用済み"), expired: tr("期限切れ") };
  const available = items.filter(c => c.state === "available").sort((a,b)=>a.expiresAt.localeCompare(b.expiresAt));
  const pending = items.filter(c => c.state === "reserved");
  const history = items.filter(c => c.state === "used" || c.state === "expired");
  const card = (c:CouponWalletItem) => <div className={`booking-card coupon-card coupon-${c.state}`} key={c.id}>
    <div><h3>{c.title} · {couponDiscountLabel(c.discount,c.currency)}</h3><p>{tr("有効期限：{0}",shopTime(c.expiresAt,{year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",timeZoneName:"short"}))}</p><span className="pill">{states[c.state]}</span></div>
    {c.state === "available" && c.currency === currencyOf(regionOf(config)) && onUse && <button type="button" onClick={()=>onUse(c.id)}>{tr("このクーポンで予約")}</button>}
  </div>;
  return <section className="coupon-wallet">
    <h3>{tr("お持ちのクーポン")}</h3>
    {available.map(card)}{pending.map(card)}
    {!!history.length && <details className="coupon-wallet-history"><summary>{tr("使用済み・期限切れ（{0}枚）",history.length)}</summary>{history.map(card)}</details>}
    <p className="small">{tr("クーポンを選んで予約へ進めます。キャンセル枠の割引との併用はできません。")}</p>
    <p className="small">{tr("通常キャンセルが確定した場合は、有効期限内のクーポンを再利用できます。無断キャンセルでは戻りません。")}</p>
  </section>;
}
