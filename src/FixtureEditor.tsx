import { tr } from "../shared/i18n";
import { useShopDisplay } from "./money";
import { localDateTime, zonedDate } from "../shared/region";
import { DateInput } from "./DateInput";
import React from "react";
import { type ShopConfig } from "../server/domain";
import { createRequestId } from "./request-id";
import { sampleFixtures, type Fixtures } from "./local-preview";
export function FixtureEditor({ value, onChange, config }: { value: Fixtures; onChange: (value: Fixtures) => void; config: ShopConfig }) {
  const { displayTimeZone, shopToday, timeZoneLabel } = useShopDisplay();
  const localTime = (value: string) => Number.isFinite(Date.parse(value)) ? localDateTime(value, displayTimeZone()) : "";
  const utcTime = (value: string) => {
    const date = value ? zonedDate(value.slice(0, 10), value.slice(11, 16), displayTimeZone()) : new Date(NaN);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  };
  function booking(index: number, change: Partial<Fixtures["bookings"][number]>) {
    onChange({ ...value, bookings: value.bookings.map((b, i) => i === index ? { ...b, ...change } : b) });
  }
  function post(index: number, change: Partial<Fixtures["posts"][number]>) {
    onChange({ ...value, posts: value.posts.map((p, i) => i === index ? { ...p, ...change } : p) });
  }
  return <div className="fixture-form">
    <label>{tr("サンプルのお客様名")}<input value={value.customerName} onChange={e => onChange({ ...value, customerName: e.target.value })} /></label>
    <h3>{tr("サンプル予約")}</h3>
    {value.bookings.map((b, index) => <fieldset className="panel" key={b.id}>
      <legend>{tr("予約 ")}{index + 1}</legend>
      <label>{tr("予約のお名前")}<input value={b.name} onChange={e => booking(index, { name: e.target.value })} /></label>
      <div className="form-grid">
        <label>{tr("予約のメニュー")}<select value={b.menuId} onChange={e => booking(index, { menuId: e.target.value })}>{config.menus.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label>{tr("予約の担当者")}<select value={b.staffId} onChange={e => booking(index, { staffId: e.target.value })}>{config.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>{tr("開始日時（{0}）", timeZoneLabel)}<DateInput aria-label={tr("開始日時（{0}）", timeZoneLabel)} withTime value={localTime(b.start)} onValueChange={value => booking(index, { start: utcTime(value) })} /></label>
        <label>{tr("終了日時（{0}）", timeZoneLabel)}<DateInput aria-label={tr("終了日時（{0}）", timeZoneLabel)} withTime value={localTime(b.end)} onValueChange={value => booking(index, { end: utcTime(value) })} /></label>
        <label>{tr("予約の状態")}<select value={b.status} onChange={e => booking(index, { status: e.target.value as typeof b.status })}><option value="active">{tr("予約確定")}</option><option value="cancelled">{tr("キャンセル済み")}</option><option value="no_show">{tr("無断キャンセル")}</option></select></label>
      </div>
      <button onClick={() => onChange({ ...value, bookings: value.bookings.filter((_, i) => i !== index) })}>{tr("このサンプル予約を削除")}</button>
    </fieldset>)}
    <button disabled={value.bookings.length >= 100} onClick={() => onChange({ ...value, bookings: [...value.bookings, { ...sampleFixtures(config).bookings[0], id: createRequestId() }] })}>{tr("サンプル予約を追加")}</button>
    <h3>{tr("サンプル記事")}</h3>
    {value.posts.map((p, index) => <fieldset className="panel" key={`${index}-${p.slug}`}>
      <legend>{tr("記事 ")}{index + 1}</legend>
      <label>{tr("記事の種類")}<select value={p.category} onChange={e => post(index, { category: e.target.value as typeof p.category })}><option value="blogs">{tr("ブログ")}</option><option value="announcements">{tr("お知らせ")}</option></select></label>
      <label>{tr("記事タイトル")}<input value={p.title} onChange={e => post(index, { title: e.target.value })} /></label>
      <label>{tr("記事の日付")}<DateInput aria-label={tr("記事の日付")} value={p.date} onValueChange={value => post(index, { date: value })} /></label>
      <label>{tr("記事の紹介文")}<textarea value={p.excerpt} onChange={e => post(index, { excerpt: e.target.value })} /></label>
      <label>{tr("記事の本文")}<textarea rows={6} value={p.body} onChange={e => post(index, { body: e.target.value })} /></label>
      <button onClick={() => onChange({ ...value, posts: value.posts.filter((_, i) => i !== index) })}>{tr("このサンプル記事を削除")}</button>
    </fieldset>)}
    <button disabled={value.posts.length >= 50} onClick={() => onChange({ ...value, posts: [...value.posts, { category: "blogs", title: tr("新しいサンプル記事"), date: shopToday(), slug: `sample-${createRequestId()}`, excerpt: "", body: tr("サンプルの本文です。") }] })}>{tr("サンプル記事を追加")}</button>
  </div>;
}
