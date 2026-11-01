import { DateInput } from "./DateInput";
import { genderOptions } from "../server/customer-profile";
import React, { useEffect, useRef, useState } from "react";
import { dateJST, type Booking, type ShopConfig } from "../server/domain";
import { customerPeriods, customerFilterSchema, customerSince, type CustomerFilter, type CustomerSummary, type CustomerDetail } from "../server/customers";
import { CustomerImageGallery } from "./CustomerImages";
import { CustomerNoteComposer, CustomerNoteCard } from "./CustomerNotes";
import { CustomerInquiry } from "./Inquiries";
import { inquiryReplied, inquiryStatus } from "../server/inquiries";
import { useApi } from "./api";

const when = (value: string) => new Date(value).toLocaleString("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;
const status = { active: "予約", cancelled: "キャンセル", no_show: "無断キャンセル" };

export function Customers({ shopId, config, initialEmail = "", initialImages = false, initialInquiryId = "", backToInquiries, inquiriesChanged }: { shopId: string; config: ShopConfig | null; initialEmail?: string; initialImages?: boolean; initialInquiryId?: string; backToInquiries?: () => void; inquiriesChanged?: () => Promise<unknown> }) {
  const api = useApi();
  const [customers, setCustomers] = useState<CustomerSummary[]>();
  const [selected, setSelected] = useState(initialEmail);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("last-desc");
  const [period, setPeriod] = useState<CustomerFilter["period"]>("all");
  const [customSince, setCustomSince] = useState(() => dateJST());
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const filter = customerFilterSchema.safeParse({ period, since: period === "custom" ? customSince : undefined });
  const ready = filter.success;
  const since = filter.success ? customerSince(filter.data, new Date()) : undefined;
  const rangeLabel = since ? `${since} 以降（日本時間）` : "全期間";
  const params = new URLSearchParams({ period, ...(period === "custom" ? { since: customSince } : {}) });
  const rangeQuery = `?${params}`;
  useEffect(() => {
    let active = true;
    setError("");
    setCustomers(undefined);
    if (!ready) return;
    api<CustomerSummary[]>(`/api/shops/${shopId}/customers${rangeQuery}`).then(result => { if (active) setCustomers(result); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [shopId, attempt, rangeQuery, ready]);
  const q = query.trim().toLowerCase();
  const visible = (customers || []).filter(customer => customer.name.toLowerCase().includes(q) || customer.email.includes(q)).sort((a, b) => {
    const direction = sort.endsWith("asc") ? 1 : -1;
    const difference = sort.startsWith("visits") ? a.visitCount - b.visitCount : (a.lastVisit ? Date.parse(a.lastVisit) : 0) - (b.lastVisit ? Date.parse(b.lastVisit) : 0);
    // Customers without visits always follow those with visits when sorting by date.
    if (sort.startsWith("last") && !!a.lastVisit !== !!b.lastVisit) return a.lastVisit ? -1 : 1;
    return direction * difference || a.email.localeCompare(b.email);
  });
  if (selected) return <CustomerProfile key={selected} shopId={shopId} email={selected} initialImages={initialImages && selected === initialEmail} config={config} rangeQuery={rangeQuery} rangeLabel={rangeLabel} initialInquiryId={selected === initialEmail ? initialInquiryId : ""} backToInquiries={backToInquiries} inquiriesChanged={inquiriesChanged} back={() => setSelected("")} saved={customer => { setCustomers(current => current?.map(item => item.email === customer.email ? customer : item)); setAttempt(value => value + 1); }} />;
  return <div className="panel customers">
    <h2>お客様一覧 {customers && <span className="pill">{customers.length}人</span>}</h2>
    <p className="muted small">予約・お問い合わせから自動で集計します。来店実績は、終了した予約のうちキャンセル・無断キャンセルを除く件数です。</p>
    {error && <div className="alert" role="alert">{error}<button onClick={() => setAttempt(value => value + 1)}>再読み込み</button></div>}
    <div className="customer-controls">
      <label>集計期間<select value={period} onChange={event => { setCustomers(undefined); setPeriod(event.target.value as CustomerFilter["period"]); }}>
        {customerPeriods.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      {period === "custom" && <label>開始日（日本時間）<DateInput aria-label="開始日（日本時間）" value={customSince} onValueChange={value => { setCustomers(undefined); setCustomSince(value); }} /></label>}
    </div>
    <p className="small muted">{ready ? `集計対象：${rangeLabel}。来店回数・最終来店日・合計金額・履歴に適用します。未来の予約も表示します。` : "開始日を指定してください。"}</p>
    <div className="customer-controls">
      <label>氏名・メールで検索<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="氏名またはメールアドレス" /></label>
      <label>並び順<select value={sort} onChange={event => setSort(event.target.value)}>
        <option value="last-desc">最終来店日が新しい順</option><option value="last-asc">最終来店日が古い順</option>
        <option value="visits-desc">来店回数が多い順</option><option value="visits-asc">来店回数が少ない順</option>
      </select></label>
    </div>
    {!customers && ready && !error && <p role="status">お客様を読み込んでいます…</p>}
    {customers?.length === 0 ? <div className="empty">{since ? "指定した期間に予約・お問い合わせはありません。" : "まだお客様はいません。予約やお問い合わせが届くと、ここに表示されます。"}</div> : customers && visible.length === 0 ? <div className="empty">検索に一致するお客様はいません。</div> : customers && <div className="customer-table-wrap"><table className="customer-table">
      <thead><tr><th>氏名</th><th>メールアドレス</th><th>来店回数</th><th>最終来店日</th><th>合計金額</th><th>メモ</th></tr></thead>
      <tbody>{visible.map(customer => <tr key={customer.email}>
        <td><button className="text-button" onClick={() => setSelected(customer.email)}>{customer.name || "氏名未記入"}</button></td>
        <td>{customer.email}</td><td>{customer.visitCount}回</td><td>{customer.lastVisit ? when(customer.lastVisit) : "来店なし"}</td>
        <td>{yen(customer.totalAmount)}</td><td>{customer.hasNote ? "あり" : "なし"}</td>
      </tr>)}</tbody>
    </table></div>}
  </div>;
}

function CustomerProfile({ shopId, email, initialImages, config, rangeQuery, rangeLabel, initialInquiryId, backToInquiries, inquiriesChanged, back, saved }: { initialInquiryId: string; backToInquiries?: () => void; inquiriesChanged?: () => Promise<unknown>; shopId: string; email: string; initialImages: boolean; config: ShopConfig | null; rangeQuery: string; rangeLabel: string; back: () => void; saved: (customer: CustomerSummary) => void }) {
  const api = useApi();
  const base = `/api/shops/${shopId}/customers/${encodeURIComponent(email)}`;
  const [customer, setCustomer] = useState<CustomerDetail>();
  const [imagesOpen, setImagesOpen] = useState(initialImages);
  const [visibleKinds, setVisibleKinds] = useState({ note: true, booking: true, inquiry: true });
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<CustomerDetail>(`${base}${rangeQuery}`).then(result => { if (active) { setCustomer(result); } }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [base, rangeQuery]);
  const inquiryNodes = useRef(new Map<string, HTMLDivElement>());
  const focusedInquiry = useRef("");
  const focusInquiry = (id: string) => {
    const node = inquiryNodes.current.get(id);
    node?.scrollIntoView({ block: "start", behavior: "smooth" });
    node?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (customer && initialInquiryId && focusedInquiry.current !== initialInquiryId && !imagesOpen) {
      focusInquiry(initialInquiryId);
      focusedInquiry.current = initialInquiryId;
    }
  }, [customer, initialInquiryId, imagesOpen]);
  const reloadInquiries = async () => {
    const result = await api<CustomerDetail>(`${base}${rangeQuery}`);
    setCustomer(result);
    saved(result);
    await inquiriesChanged?.();
  };
  const changed = (result: CustomerDetail) => { setCustomer(result); saved(result); };
  const history = customer?.history.filter(event => visibleKinds[event.kind]) || [];
  const hasSelection = Object.values(visibleKinds).some(Boolean);
  return <div className="customers">
    {imagesOpen && <CustomerImageGallery base={base} rangeQuery={rangeQuery} saved={changed} back={() => setImagesOpen(false)} />}
    <div hidden={imagesOpen}>
    <div className="actions">{initialInquiryId && backToInquiries && <button onClick={backToInquiries}>← お問い合わせ一覧へ</button>}<button onClick={back}>← お客様一覧へ</button></div>
    {error && <div className="alert" role="alert">{error}</div>}
    {!customer && !error && <p role="status">履歴を読み込んでいます…</p>}
    {customer && <>
      <div className="panel customer-profile">
        <div className="section-top"><h2>{customer.name || "氏名未記入"}</h2><a data-customer-images-link className="button" href={`?${new URLSearchParams({ shop: shopId, customer: email, customerView: "images" })}`} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); setImagesOpen(true); } }}>画像一覧</a></div>
        <p className="small muted">集計対象：{rangeLabel}</p>
        <h3>基本情報</h3><dl className="customer-basic-info"><div><dt>お名前</dt><dd>{customer.name || "未登録"}</dd></div><div><dt>メールアドレス</dt><dd>{customer.email}</dd></div><div><dt>生年月日</dt><dd>{customer.profile?.birthDate.replace(/-/g, "/") || "未登録"}</dd></div><div><dt>性別</dt><dd>{genderOptions.find(option => option.value === customer.profile?.gender)?.label || "未登録"}</dd></div></dl>
        <dl className="customer-stats"><div><dt>来店回数</dt><dd>{customer.visitCount}回</dd></div><div><dt>最終来店日</dt><dd>{customer.lastVisit ? when(customer.lastVisit) : "来店なし"}</dd></div><div><dt>合計金額</dt><dd>{yen(customer.totalAmount)}</dd></div></dl>
        <CustomerNoteComposer base={base} rangeQuery={rangeQuery} saved={changed} />
      </div>
      {customer.history.some(event => event.kind === "booking") && <section className="panel customer-bookings" aria-label="予約内容"><h2>予約内容</h2><p className="small muted">集計対象：{rangeLabel}（日本時間）</p>
        {customer.history.filter(event => event.kind === "booking" && event.booking.status === "active" && Date.parse(event.booking.end) > Date.now()).sort((a,b) => Date.parse(a.at) - Date.parse(b.at)).map(event => event.kind === "booking" && <CustomerBooking key={event.booking.id} booking={event.booking} config={config} />)}
        {customer.history.some(event => event.kind === "booking" && (event.booking.status !== "active" || Date.parse(event.booking.end) <= Date.now())) && <details><summary>過去の予約・キャンセル</summary>{customer.history.map(event => event.kind === "booking" && (event.booking.status !== "active" || Date.parse(event.booking.end) <= Date.now()) && <CustomerBooking key={event.booking.id} booking={event.booking} config={config} />)}</details>}
      </section>}
      <section className="panel customer-inquiries" aria-label="お問い合わせへの対応"><h2>お問い合わせへの対応</h2><p className="small muted">返信はお客様のメールへ送信します。返信の有無と対応状況は別々に管理します。対応が終わったら「対応済み」に変更してください。</p>
        {!customer.history.some(event => event.kind === "inquiry") && <p className="empty">この期間のお問い合わせはありません。</p>}
        {customer.history.map(event => event.kind === "inquiry" && <div key={event.inquiry.id} data-inquiry-id={event.inquiry.id} className="customer-inquiry-target" tabIndex={-1} ref={node => { if (node) inquiryNodes.current.set(event.inquiry.id,node); else inquiryNodes.current.delete(event.inquiry.id); }}><CustomerInquiry shopId={shopId} inquiry={event.inquiry} onChanged={reloadInquiries} onReload={reloadInquiries}/></div>)}
      </section>
      <div className="panel"><h2>お客様のタイムライン</h2><p className="small muted">チェックした種類を新しい順に表示（日本時間）</p>
        <fieldset className="customer-history-filter">
          <legend>タイムラインの表示</legend>
          {([{ kind: "note", label: "メモ" }, { kind: "booking", label: "予約" }, { kind: "inquiry", label: "お問い合わせ" }] as const).map(({ kind, label }) => <label key={kind}>
            <input type="checkbox" checked={visibleKinds[kind]} onChange={event => { const checked = event.target.checked; setVisibleKinds(current => ({ ...current, [kind]: checked })); }} />{label}
          </label>)}
        </fieldset>
        {history.length === 0 && <p className="empty">{hasSelection ? "指定した期間に、選択した種類の履歴はありません。" : "表示する種類を選択してください。"}</p>}
        <ol className="customer-history">{history.map(event => <li key={`${event.kind}-${event.kind === "booking" ? event.booking.id : event.kind === "inquiry" ? event.inquiry.id : event.note.id}`}>
          <time dateTime={event.at}>{when(event.at)}</time>
          {event.kind === "note" ? <CustomerNoteCard note={event.note} showAttachments={!imagesOpen} base={base} rangeQuery={rangeQuery} saved={changed} /> : event.kind === "booking" ? <>
            <h3>予約 · {config?.menus.find(menu => menu.id === event.booking.menuId)?.name || event.booking.menuId}</h3>
            <p><span className={`status ${event.booking.status}`}>{event.booking.status === "active" && Date.parse(event.booking.end) <= Date.now() ? "来店済み" : status[event.booking.status]}</span>　{yen(event.booking.price)}</p>
            {event.booking.message && <p className="customer-message"><b>予約時のメッセージ</b><br />{event.booking.message}</p>}
            <p className="small muted">担当：{config?.staff.find(staff => staff.id === event.booking.staffId)?.name || event.booking.staffId} · 終了 {when(event.booking.end)}</p>
          </> : <><h3>お問い合わせ · {inquiryStatus(event.inquiry) === "completed" ? "対応済み" : "対応中"} · {inquiryReplied(event.inquiry) ? "返信済み" : "未返信"}</h3><p className="inquiry-message-preview">{event.inquiry.message}</p><button onClick={() => focusInquiry(event.inquiry.id)}>お問い合わせの対応を見る</button></>}
        </li>)}</ol>
      </div>
    </>}
    </div>
  </div>;
}

function CustomerBooking({booking,config}:{booking:Booking;config:ShopConfig|null}) {
  return <article className="customer-booking"><h3>{config?.menus.find(menu=>menu.id===booking.menuId)?.name || booking.menuId}</h3><p><time dateTime={booking.start}>{when(booking.start)}</time> 〜 <time dateTime={booking.end}>{when(booking.end)}</time></p><p><span className={`status ${booking.status}`}>{booking.status === "active" && Date.parse(booking.end) <= Date.now() ? "来店済み" : status[booking.status]}</span>　{yen(booking.price)}</p><p>担当：{config?.staff.find(staff=>staff.id===booking.staffId)?.name || booking.staffId}</p>{booking.message && <p className="customer-message"><b>予約時のメッセージ</b><br/>{booking.message}</p>}</article>;
}
