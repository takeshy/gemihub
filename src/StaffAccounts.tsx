import { MenuImageEditor } from "./MenuImage";
import { createRequestId } from "./request-id";
import React, { useEffect, useState } from "react";
import { useApi } from "./api";
import type { Workspace } from "./App";
type StaffRow = {
  staffId: string;
  name: string;
  email: string;
  accepted: boolean;
  connected: boolean;
};
type Accounts = { staff: StaffRow[]; loginUrl: string; configured: boolean };
export function StaffAccounts({ shop }: { shop: Workspace }) {
  const api = useApi();
  const [data, setData] = useState<Accounts>();
  const [error, setError] = useState("");
  const load = async () => {
    const result = await api<Accounts>(`/api/shops/${shop.id}/staff-accounts`);
    setData(result);
  };
  useEffect(() => {
    void load().catch((error) => setError(error.message));
  }, [shop.id, shop.revision]);
  return (
    <section
      className="panel staff-accounts"
      aria-label="スタッフのGoogleログイン"
    >
      <h2>スタッフのGoogleログイン</h2>
      <p>
        スタッフごとにGoogleアカウントのメールアドレスを登録してください。本人が下のURLからログインすると、カレンダーの利用許可も一緒に行えます。
      </p>
      <p className="small muted">
        登録したスタッフは予約・お客様・お問い合わせを管理できます。予定の件名や本文は取得せず、カレンダーの「予定あり」の時間を予約枠から除外します。
      </p>
      {error && (
        <p role="alert" className="alert">
          {error}
          <button
            onClick={() => {
              setError("");
              void load().catch((error) => setError(error.message));
            }}
          >
            最新の登録を確認
          </button>
        </p>
      )}
      {data && (
        <>
          <label>
            スタッフ用ログインURL
            <input
              aria-label="スタッフ用ログインURL"
              readOnly
              value={new URL(data.loginUrl, location.origin).href}
            />
          </label>
          <a className="button" data-staff-login-link href={data.loginUrl}>
            スタッフ用ログイン画面を開く
          </a>
          {!data.configured && (
            <p className="notice">
              Googleログインを利用するにはサーバーの設定が必要です。
            </p>
          )}
          <div className="staff-account-rows">
            {data.staff.map((staff) => (
              <StaffAccountRow
                key={staff.staffId}
                shopId={shop.id}
                staff={staff}
                saved={load}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
function StaffAccountRow({
  shopId,
  staff,
  saved,
}: {
  shopId: string;
  staff: StaffRow;
  saved: () => Promise<void>;
}) {
  const api = useApi();
  const [email, setEmail] = useState(staff.email),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    setEmail(staff.email);
  }, [staff.email]);
  async function save(value: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/shops/${shopId}/staff-accounts`, {
        staffId: staff.staffId,
        email: value.trim().toLowerCase(),
        previousEmail: staff.email,
      });
      await saved();
      setNotice(
        value
          ? "登録しました。本人にスタッフ用ログインURLを伝えてください。"
          : "登録を解除しました。",
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className="staff-account-row"
      aria-label={`${staff.name}のログイン設定`}
    >
      <h3>{staff.name}</h3>
      <p className="small muted">
        {!staff.email
          ? "未登録"
          : !staff.accepted
            ? "初回ログイン待ち"
            : staff.connected
              ? "カレンダー連携中"
              : "カレンダー未連携"}
      </p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(email);
        }}
      >
        <label>
          Googleアカウントのメールアドレス
          <input
            type="email"
            aria-label="Googleアカウントのメールアドレス"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            required
            maxLength={254}
          />
        </label>
        <div className="actions">
          <button
            className="primary"
            disabled={
              busy ||
              !email.trim() ||
              email.trim().toLowerCase() === staff.email
            }
          >
            登録する
          </button>
          {staff.email && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    `${staff.name}のログイン登録を解除しますか？運営の権限とカレンダー連携が解除されます。`,
                  )
                )
                  void save("");
              }}
            >
              ログイン登録を解除
            </button>
          )}
        </div>
      </form>
    </article>
  );
}
export function StaffCalendar({ shop }: { shop: Workspace }) {
  const api = useApi();
  const [connection, setConnection] = useState<{
    connected: boolean;
    email: string;
    staffId?: string;
    configured: boolean;
    loginUrl: string;
  }>();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () =>
    setConnection(await api(`/api/shops/${shop.id}/calendar`));
  useEffect(() => {
    void load().catch((error) => setError(error.message));
  }, [shop.id]);
  const staff = shop.published?.staff.find(
    (staff) => staff.id === connection?.staffId,
  );
  return (
    <section className="panel staff-calendar" aria-label="自分のカレンダー">
      <h2>自分のカレンダー</h2>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {connection && (
        <>
          <p>{connection.email}</p>
          <p>
            {connection.connected
              ? staff
                ? `${staff.name} · カレンダー連携中`
                : "担当スタッフが削除されています。店主に確認してください。"
              : "カレンダー未連携"}
          </p>
          <p>
            スタッフ用のGoogleログインで、カレンダーの利用許可も行います。予定の件名・本文は取得しません。
          </p>
          <a
            className="button"
            data-staff-login-link
            href={connection.loginUrl}
          >
            Googleでログインしてカレンダーを許可
          </a>
          {connection.connected && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api(`/api/shops/${shop.id}/calendar/disconnect`, {});
                  await load();
                } catch (error) {
                  setError(
                    error instanceof Error ? error.message : String(error),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              カレンダー連携を解除
            </button>
          )}
        </>
      )}
    </section>
  );
}
export function StaffLogin({ shopId }: { shopId: string }) {
  const api = useApi();
  const [data, setData] = useState<{ name: string; configured: boolean }>(),
    [error, setError] = useState("");
  useEffect(() => {
    api<{ name: string; configured: boolean }>(`/api/staff-login/${shopId}`)
      .then(setData)
      .catch((error) => setError(error.message));
  }, [shopId]);
  return (
    <main className="staff-login panel">
      <h1>スタッフ用ログイン</h1>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <h2>{data.name}</h2>
          <p>
            店主が登録したGoogleアカウントでログインしてください。ログイン時にGoogleカレンダーの利用許可も行います。
          </p>
          <p>
            メインカレンダーの「予定あり」の時間を予約できない時間として扱います。予定の件名・本文は取得しません。
          </p>
          {data.configured ? (
            <a
              className="button primary"
              href={`/auth/google?${new URLSearchParams({ staffShop: shopId })}`}
            >
              Googleでログインしてカレンダーを許可
            </a>
          ) : (
            <p className="notice">
              Googleログインの設定が完了していません。店主に確認してください。
            </p>
          )}
        </>
      )}
    </main>
  );
}

export function StaffPhoto({
  shop,
  reload,
}: {
  shop: Workspace;
  reload: () => Promise<unknown>;
}) {
  const api = useApi();
  const base = `/api/shops/${shop.id}/staff-photo`;
  const [staff, setStaff] = useState<{
      staffId: string;
      name: string;
      imageId?: string;
    }>(),
    [imageId, setImageId] = useState<string>();
  const [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [requestId, setRequestId] = useState(createRequestId);
  const load = async () => {
    const value = await api<NonNullable<typeof staff>>(base);
    setStaff(value);
    setImageId(value.imageId);
    setRequestId(createRequestId());
  };
  useEffect(() => {
    void load().catch((error) => setError(error.message));
  }, [base]);
  return (
    <section className="panel own-staff-photo" aria-label="自分のスタッフ写真">
      <h2>自分のスタッフ写真</h2>
      <p>
        写真を選んで保存すると、お客様の「お店のこと」とスタッフを指名した予約画面に表示されます。
      </p>
      {error && (
        <p className="alert" role="alert">
          {error}
          <button
            disabled={busy || uploading}
            onClick={() => {
              setError("");
              void load().catch((error) => setError(error.message));
            }}
          >
            最新の写真を確認
          </button>
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {staff && (
        <>
          <h3>{staff.name}</h3>
          <fieldset disabled={busy}>
            <MenuImageEditor
              shopId={shop.id}
              label="スタッフ写真（任意）"
              name={staff.name}
              imageId={imageId}
              change={(value) => {
                setImageId(value);
                setRequestId(createRequestId());
                setNotice("");
              }}
              uploading={setUploading}
              imageBase={`${base}/images`}
              pickerBase={`${base}/images`}
              uploadPath={`${base}/images`}
            />
          </fieldset>
          <button
            className="primary"
            disabled={busy || uploading || imageId === staff.imageId}
            onClick={async () => {
              setBusy(true);
              setError("");
              setNotice("");
              try {
                await api(base, {
                  imageId,
                  previousImageId: staff.imageId || "",
                  requestId,
                });
                await load();
                await reload();
                setNotice("スタッフ写真を保存しました。");
              } catch (error) {
                setError(
                  error instanceof Error ? error.message : String(error),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            写真を保存
          </button>
        </>
      )}
    </section>
  );
}
