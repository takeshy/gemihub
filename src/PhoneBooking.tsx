import React, { useEffect, useRef, useState } from "react";
import { useApi } from "./api";
import { tr } from "../shared/i18n";
import { dateIn, regionOf, type Currency } from "../shared/region";
import { bookingStaff, menuSelection, type ShopConfig } from "../server/domain";
import { createRequestId } from "./request-id";
import { DateInput } from "./DateInput";
import { paid, useShopDisplay } from "./money";

type Slot = { start: string; end: string; staffId: string };

/** The number comes first: a returning caller's name fills in from it, without replacing a typed name. */
function PhoneCustomerFields({ shopId, phone, name, onPhone, onName }: { shopId: string; phone: string; name: string; onPhone: (value: string) => void; onName: (value: string) => void }) {
  const api = useApi();
  const [known, setKnown] = useState(false);
  const current = useRef({ shopId, phone, name });
  current.current = { shopId, phone, name };
  const search = useRef(0);
  useEffect(() => () => { search.current++; }, [shopId, phone]);
  const find = async () => {
    if (!phone.trim()) return;
    const request = ++search.current;
    const result = await api<{ name: string }>(`/api/shops/${shopId}/customers/phone?number=${encodeURIComponent(phone)}`).catch(() => ({ name: "" }));
    if (request !== search.current || current.current.shopId !== shopId || current.current.phone !== phone) return;
    setKnown(!!result.name);
    if (result.name && !current.current.name.trim()) onName(result.name);
  };
  return <>
    <label className="field"><span>{tr("電話番号")}</span><input required type="tel" autoComplete="off" maxLength={40} value={phone} onChange={e => { search.current++; current.current.phone = e.target.value; setKnown(false); onPhone(e.target.value); }} onBlur={() => void find()}/></label>
    {known && <p className="small muted" role="status">{tr("登録済みのお客様です。")}</p>}
    <label className="field"><span>{tr("お名前")}</span><input required maxLength={100} value={name} onChange={e => { current.current.name = e.target.value; onName(e.target.value); }}/></label>
  </>;
}

/** Phone bookings, paid in cash at the shop: today's only under online prepayment, any open date without it. */
export function PhoneBooking({ shopId, config, reload }: { shopId: string; config: ShopConfig; reload: () => Promise<unknown> }) {
  const api = useApi(), base = `/api/shops/${shopId}/bookings`;
  const { money, shopTime } = useShopDisplay(regionOf(config));
  const menus = config.menus.filter(menu => menu.active && !menu.optionFor);
  const [open, setOpen] = useState(false), [menu, setMenu] = useState(menus[0]?.id || ""), [optionIds, setOptionIds] = useState<string[]>([]), [staff, setStaff] = useState("");
  const [times, setTimes] = useState<Slot[]>(), [start, setStart] = useState(""), [name, setName] = useState(""), [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [requestId, setRequestId] = useState(createRequestId);
  const prepaid = !!config.rules.payment?.enabled, [date, setDate] = useState(() => dateIn(new Date(), regionOf(config).timeZone));
  const selection = menuSelection(config, menu, optionIds), options = config.menus.filter(option => option.active && option.optionFor?.includes(menu));
  const load = async () => {
    const query = new URLSearchParams({ menu, ...(staff ? { staff } : {}), ...(prepaid ? {} : { date }) });
    for (const id of optionIds) query.append("option", id);
    const result = await api<{ slots: Slot[] }>(`${base}/phone-slots?${query}`);
    setTimes(result.slots); setStart(current => result.slots.some(slot => slot.start === current) ? current : "");
  };
  useEffect(() => { if (open && menu) { setTimes(undefined); load().catch(e => setError(e instanceof Error ? e.message : tr("操作できませんでした"))); } }, [open, menu, optionIds, staff, date]);
  const changed = () => { setRequestId(createRequestId()); setNotice(""); };
  return <details className="phone-booking" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{prepaid ? tr("当日の電話予約を登録") : tr("電話予約を登録")}</summary>
    <p className="small muted">{prepaid ? tr("今日の空き枠だけを、店頭での現金払いとして登録します。オンライン予約と同じ枠を使うので二重予約になりません。キャンセル受付中の枠は選べません。お名前と電話番号はお客様一覧にも登録します。") : tr("空き枠を、店頭での現金払いとして登録します。オンライン予約と同じ枠を使うので二重予約になりません。お名前と電話番号はお客様一覧にも登録します。")}</p>
    {error && <p role="alert" className="alert">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    <form onSubmit={event => {
      event.preventDefault(); setBusy(true); setError(""); setNotice("");
      void (async () => {
        try {
          await api(`${base}/phone`, { requestId, name, phone, menuId: menu, optionIds, ...(staff ? { staffId: staff } : {}), start, expectedPrice: selection?.price });
          setNotice(tr("{0} 様の電話予約を登録しました。", name));
          setName(""); setPhone(""); setStart(""); setRequestId(createRequestId());
          await Promise.all([reload(), load()]);
        } catch (e) { setError(e instanceof Error ? e.message : tr("操作できませんでした")); await load().catch(() => {}); }
        finally { setBusy(false); }
      })();
    }}>
      <fieldset disabled={busy}>
        <legend>{tr("電話予約の内容")}</legend>
        <label className="field"><span>{tr("メニュー")}</span><select aria-label={tr("メニュー")} value={menu} onChange={e => { setMenu(e.target.value); setOptionIds([]); changed(); }}>{menus.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {options.map(option => <label className="check-field" key={option.id}><input type="checkbox" checked={optionIds.includes(option.id)} onChange={e => { setOptionIds(current => e.target.checked ? [...current, option.id] : current.filter(id => id !== option.id)); changed(); }}/>{option.name}</label>)}
        <label className="field"><span>{tr("スタッフ")}</span><select aria-label={tr("スタッフ")} value={staff} onChange={e => { setStaff(e.target.value); changed(); }}><option value="">{tr("指名なし")}</option>{bookingStaff(config).filter(person => person.menuIds.includes(menu)).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        {!prepaid && <label className="field"><span>{tr("日付")}</span><DateInput aria-label={tr("日付")} value={date} onValueChange={value => { setDate(value); changed(); }}/></label>}
        <label className="field"><span>{prepaid ? tr("今日の時間") : tr("時間")}</span><select aria-label={prepaid ? tr("今日の時間") : tr("時間")} required value={start} onChange={e => { setStart(e.target.value); changed(); }}><option value="">{times ? tr("時間を選ぶ") : tr("読み込み中…")}</option>{times?.map(slot => <option key={slot.start} value={slot.start}>{shopTime(slot.start, { hour: "2-digit", minute: "2-digit" })}</option>)}</select></label>
        {times?.length === 0 && <p className="small muted">{prepaid ? tr("今日の空き枠はありません。") : tr("この日の空き枠はありません。")}</p>}
        <PhoneCustomerFields shopId={shopId} phone={phone} name={name} onPhone={value => { setPhone(value); changed(); }} onName={value => { setName(value); changed(); }}/>
        {selection && <p>{tr("店頭で現金払い：{0}", money(selection.price))}</p>}
        <button className="primary" type="submit" disabled={!start}>{tr("電話予約を登録する")}</button>
      </fieldset>
    </form>
  </details>;
}

/** Give a slot awaiting a replacement to a cash customer, raising the holder's refund as promised. */
export function PhoneReplacement({ shopId, listing, reload }: { shopId: string; listing: { id: string; price: number; currency: Currency; unsold: number }; reload: () => Promise<unknown> }) {
  const api = useApi();
  const [name, setName] = useState(""), [phone, setPhone] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [requestId, setRequestId] = useState(createRequestId);
  const summary = tr("{0}を店頭で現金で受け取り、元の予約者への返金を{1}から{2}に増やします。元の予約はキャンセルされます。", paid(listing.price, listing.currency), paid(listing.unsold, listing.currency), paid(listing.price, listing.currency));
  return <details className="phone-booking">
    <summary>{tr("現金のお客様に差し替える")}</summary>
    <p className="small muted">{summary}</p>
    {error && <p role="alert" className="alert">{error}</p>}
    <form onSubmit={event => {
      event.preventDefault();
      if (!window.confirm(summary)) return;
      setBusy(true); setError("");
      void api(`/api/shops/${shopId}/transfers/${listing.id}/phone`, { requestId, name, phone, expectedPrice: listing.price }).then(() => reload()).catch(e => setError(e instanceof Error ? e.message : tr("操作できませんでした"))).finally(() => setBusy(false));
    }}>
      <fieldset disabled={busy}>
        <legend>{tr("差し替えるお客様")}</legend>
        <PhoneCustomerFields shopId={shopId} phone={phone} name={name} onPhone={value => { setPhone(value); setRequestId(createRequestId()); }} onName={value => { setName(value); setRequestId(createRequestId()); }}/>
        <button className="primary" type="submit">{tr("差し替えて返金を増やす")}</button>
      </fieldset>
    </form>
  </details>;
}
