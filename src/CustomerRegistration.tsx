import { tr } from "../shared/i18n";
import React, { useState } from "react";
import { DateInput } from "./DateInput";
import { useApi } from "./api";
import { customerProfileSchema, genderOptions, type MemberProfile } from "../server/customer-profile";
import { dateJST } from "../server/domain";

export function CustomerRegistration({ base, email, name, profile, onSaved }: { base: string; email: string; name: string; profile?: MemberProfile | null; onSaved: (profile: MemberProfile) => void }) {
  const api = useApi();
  const [inputName, setName] = useState(profile?.name || name);
  const [birthDate, setBirthDate] = useState(profile?.birthDate || "");
  const [gender, setGender] = useState(profile?.gender || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="panel customer-registration" onSubmit={event => {
    event.preventDefault(); setError("");
    const checked = customerProfileSchema.safeParse({ name: inputName, birthDate, gender });
    if (!checked.success) { setError(checked.error.issues[0].message); return; }
    setBusy(true);
    void api<{profile: MemberProfile}>(`${base}/profile`, checked.data).then(result => onSaved(result.profile)).catch(error => setError(error.message)).finally(() => setBusy(false));
  }}>
    <span className="pill">{tr("メールアドレス確認済み")}</span><h2>{profile ? tr("会員情報を変更する") : tr("会員情報を登録する")}</h2>
    <p>{tr("予約で使うお名前などを登録してください。次の予約から、お名前が自動入力されます。")}</p>
    <p className="registration-email">{tr("確認済みのメールアドレス：")}<b>{email}</b></p>
    {error && <p className="alert" role="alert">{error}</p>}
    <fieldset disabled={busy}>
      <label>{tr("お名前")}<input autoComplete="name" required maxLength={100} value={inputName} onChange={event => setName(event.target.value)} /></label>
      <label>{tr("生年月日")}<DateInput aria-label={tr("生年月日")} required value={birthDate} max={dateJST()} onValueChange={setBirthDate} autoComplete="bday" /></label>
      <label>{tr("性別")}<select aria-label={tr("性別")} required value={gender} onChange={event => setGender(event.target.value)}><option value="">{tr("選んでください")}</option>{genderOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <p className="small muted">{tr("この情報は、あなたとお店の運営者が確認できます。")}</p>
      <button className="primary" disabled={busy}>{busy ? tr("保存しています…") : profile ? tr("保存する") : tr("登録して予約へ進む")}</button>
    </fieldset>
  </form>;
}
