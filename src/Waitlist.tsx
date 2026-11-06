import React, { useEffect, useState } from "react";
import { tr } from "../shared/i18n";
import { bookingDates, bookingStaffName, hoursForDate, ownerStaffId, type ShopConfig } from "../server/domain";
import { DateInput } from "./DateInput";
import { useApi } from "./api";

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="field"><span>{label}</span>{children}</label>;
type Run = (fn: () => Promise<void>) => Promise<void> | void;
export type SlotWish = { id: string; date: string; from: string; to: string; menuId: string; optionIds: string[]; staffId?: string; discountOnly: boolean };

/** Sits under the time list, so it starts from the service, staff and date already chosen. */
export function WaitlistRequest({ base, config, date, menuId, optionIds, staffId, busy, run, notify, reload }: {
  base: string; config: ShopConfig; date: string; menuId: string; optionIds: string[]; staffId: string;
  busy: boolean; run: Run; notify: (message: string) => void; reload: () => Promise<void>;
}) {
  const api = useApi();
  const dates = bookingDates(config);
  const [wishDate, setWishDate] = useState(date);
  const hours = hoursForDate(config, wishDate || dates[0] || "");
  const [from, setFrom] = useState(hours.start);
  const [to, setTo] = useState(hours.end);
  const [discountOnly, setDiscountOnly] = useState(false);
  useEffect(() => { if (date) setWishDate(date); }, [date]);
  useEffect(() => { setFrom(hours.start); setTo(hours.end); }, [hours.start, hours.end]);
  return <details className="waitlist-request">
    <summary>{tr("希望の時間が空いたら知らせる")}</summary>
    <p className="small muted">{tr("選んだメニューと担当で、希望の時間帯に空きが出るとメールでお知らせします。通知では予約枠は確保されません。予約は先着順です。")}</p>
    <Field label={tr("希望の日付")}>
      <DateInput aria-label={tr("希望の日付")} min={dates[0]} max={dates.at(-1)} value={wishDate} onValueChange={setWishDate} />
    </Field>
    <div className="waitlist-times">
      <Field label={tr("開始")}><input type="time" value={from} onChange={event => setFrom(event.target.value)} /></Field>
      <Field label={tr("終了")}><input type="time" value={to} onChange={event => setTo(event.target.value)} /></Field>
    </div>
    {!!config.rules.payment?.enabled && <label className="check-field"><input type="checkbox" checked={discountOnly} onChange={event => setDiscountOnly(event.target.checked)} /> {tr("お得な空き枠だけ知らせる")}</label>}
    <button type="button" disabled={busy || !wishDate || !from || !to || from >= to} onClick={() => run(async () => {
      await api(`${base}/waitlist`, { date: wishDate, from, to, menuId, optionIds, ...(staffId ? { staffId } : {}), discountOnly });
      await reload();
      notify(tr("空き通知を登録しました。マイページでいつでも止められます。"));
    })}>{tr("空き通知を登録")}</button>
  </details>;
}

/** On My page: what the customer is waiting for, each stoppable. */
export function WaitlistWishes({ base, config, wishes, busy, run, reload }: {
  base: string; config: ShopConfig; wishes: SlotWish[]; busy: boolean; run: Run; reload: () => Promise<void>;
}) {
  const api = useApi();
  if (!wishes.length) return null;
  const named = config.staff.some(person => person.id !== ownerStaffId);
  return <div className="waitlist-wishes">
    <h3>{tr("空き通知")}</h3>
    {wishes.map(wish => <div className="booking-card" key={wish.id}>
      <div>
        {wish.discountOnly && <span className="status transfer">{tr("お得な空き枠のみ")}</span>}
        <h3>{wish.date.replaceAll("-", "/")} {wish.from}–{wish.to}</h3>
        <p>{config.menus.find(menu => menu.id === wish.menuId)?.name || tr("現在は受け付けていないメニュー")}{named && <> / {wish.staffId ? bookingStaffName(config, wish.staffId) : tr("スタッフの指名なし")}</>}</p>
      </div>
      <div className="actions">
        <button disabled={busy} onClick={() => run(async () => {
          await api(`${base}/waitlist/${wish.id}/remove`, {});
          await reload();
        })}>{tr("通知を止める")}</button>
      </div>
    </div>)}
  </div>;
}
