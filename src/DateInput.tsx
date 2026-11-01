import React, { useEffect, useRef, useState } from "react";
import { displayDateInput, parseDateInput } from "./date-input";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  withTime?: boolean;
};

export function DateInput({ value, onValueChange, withTime = false, min, max, disabled, ...props }: Props) {
  const [draft, setDraft] = useState(() => displayDateInput(value));
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const emitted = useRef(value);
  const format = withTime ? "YYYY/MM/DD HH:mm" : "YYYY/MM/DD";
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setDraft(displayDateInput(value)); setError(""); input.current?.setCustomValidity("");
  }, [value]);
  function update(text: string, normalize = false) {
    const parsed = parseDateInput(text, withTime);
    const complete = normalize || text.length === (withTime ? 16 : 10);
    setDraft(parsed && complete ? displayDateInput(parsed) : text);
    const invalid = text && (!parsed || (min && parsed < String(min)) || (max && parsed > String(max)));
    const message = invalid ? `${format} の形式で、有効な${withTime ? "日時" : "日付"}を入力してください。${min ? ` ${displayDateInput(String(min))} 以降を選べます。` : ""}` : "";
    input.current?.setCustomValidity(message);
    setError(message);
    const next = !message && parsed && complete ? parsed : "";
    if (next !== emitted.current) { emitted.current = next; onValueChange(next); }
  }
  return <span className="date-input">
    <span className="date-input-controls">
      <input {...props} ref={input} type="text" value={draft} disabled={disabled} inputMode="text" placeholder={format} maxLength={withTime ? 16 : 10} onChange={event => update(event.target.value)} onBlur={event => { update(draft, true); props.onBlur?.(event); }} />
      <button type="button" disabled={disabled} aria-label={withTime ? "カレンダーで日時を選ぶ" : "カレンダーで日付を選ぶ"} onClick={event => { event.preventDefault(); try { picker.current?.showPicker(); } catch { picker.current?.focus(); } }}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 2v6M17 2v6M3 11h18M7 15h3M14 15h3" /></svg></button>
      <input ref={picker} className="date-native-picker" type={withTime ? "datetime-local" : "date"} value={value} min={min} max={max} disabled={disabled} tabIndex={-1} aria-hidden="true" onChange={event => update(event.target.value, true)} />
    </span>
    <small className="date-input-format">{format}{error && <span role="status"> — {error}</span>}</small>
  </span>;
}
