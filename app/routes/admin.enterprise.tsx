import { useCallback, useEffect, useState } from "react";
import { Form, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/admin.enterprise";
import { getTokens } from "~/services/session.server";
import { isSuperAdmin } from "~/services/super-admin.server";
import type { OrganizationLifecycle } from "~/types/hubwork";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await getTokens(request);
  if (!tokens?.email) throw new Response("not authenticated", { status: 401 });
  if (!isSuperAdmin(tokens.email)) {
    // statusText is a ByteString (Latin-1 only) — a non-ASCII reason phrase
    // makes `new Response` throw a TypeError, turning this 403 into a crash.
    // It is also the only part the root ErrorBoundary renders, so the guidance
    // lives here rather than in the body.
    throw new Response("service administrator only", {
      status: 403,
      statusText:
        "Service administrator only: sign in with an account listed in SUPER_ADMIN_EMAILS",
    });
  }
  return { email: tokens.email };
}

interface OrgItem { id: string; name: string }

interface VertexStatus {
  connected: boolean;
  connectedEmail: string | null;
  clientConfigured: boolean;
  projectId: string | null;
}

interface OrgVertexStatus extends VertexStatus {
  source: "default" | "own";
  serviceDefault: VertexStatus;
}

interface AccountItem {
  id: string;
  email: string;
  accountSlug: string;
  defaultDomain: string;
  customDomain?: string;
  plan: "lite" | "business" | "granted";
  billingStatus: "active" | "past_due" | "canceled";
  accountStatus: "enabled" | "disabled";
  domainStatus: "none" | "pending_dns" | "provisioning_cert" | "active" | "failed";
  orgId?: string;
  projectId?: string;
  canceledAt?: string;
  deleteAfter?: string;
  lifecycle: OrganizationLifecycle;
}

type Message = { kind: "error" | "success"; text: string };

type Tab = "orgs" | "accounts";

const input =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";
const primaryButton =
  "rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton =
  "rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50";
const cardClass = "rounded-xl border border-gray-200 bg-white p-6 shadow-sm";

/** Parse the "web application" OAuth client JSON downloaded from Google Cloud. */
async function parseOAuthJson(file: File, callbackUrl: string) {
  const document = JSON.parse(await file.text()) as {
    web?: { client_id?: string; client_secret?: string; project_id?: string; redirect_uris?: string[] };
    installed?: unknown;
  };
  const web = document.web;
  if (!web && document.installed) {
    throw new Error(
      `これは「デスクトップ アプリ」用JSONです。Google Cloudで「ウェブ アプリケーション」を作成し、${callbackUrl} を承認済みリダイレクトURIに登録してください`,
    );
  }
  if (!web?.client_id || !web.client_secret || !web.project_id || !Array.isArray(web.redirect_uris)) {
    throw new Error("Google Cloudで作成した「ウェブ アプリケーション」用OAuthクライアントJSONを選択してください");
  }
  return {
    clientId: web.client_id,
    clientSecret: web.client_secret,
    projectId: web.project_id,
    redirectUris: web.redirect_uris,
  };
}

async function vertexApi(body: object, method: "POST" | "DELETE" = "POST"): Promise<void> {
  const res = await fetch("/api/orgs/vertex-oauth", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
}

async function accountApi(body: object, method: "POST" | "DELETE" = "POST"): Promise<void> {
  const res = await fetch("/api/admin/accounts", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
}

function StatusLines({ status }: { status: VertexStatus | null }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 text-sm">
      <p>
        OAuthクライアント:{" "}
        {status?.clientConfigured
          ? <span className="font-medium text-green-700">設定済み（{status.projectId}）</span>
          : <span className="text-gray-500">未設定</span>}
      </p>
      <p className="mt-1">
        Google連携:{" "}
        {status?.connected
          ? <span className="font-medium text-green-700">接続済み（{status.connectedEmail}）</span>
          : <span className="text-gray-500">未接続</span>}
      </p>
    </div>
  );
}

export default function AdminEnterprise() {
  const { email } = useLoaderData<typeof loader>();
  const [tab, setTab] = useState<Tab>("orgs");
  const [view, setView] = useState<{ name: "list" } | { name: "new" } | { name: "edit"; org: OrgItem }>({ name: "list" });

  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [defaultStatus, setDefaultStatus] = useState<VertexStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const callbackUrl = typeof window === "undefined"
    ? "/auth/vertex/callback"
    : `${window.location.origin}/auth/vertex/callback`;

  const loadOrgs = useCallback(async () => {
    setOrgsLoading(true);
    try {
      const res = await fetch("/api/orgs/list");
      const data = await res.json() as { organizations?: OrgItem[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setOrgs(data.organizations ?? []);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "組織一覧を取得できませんでした" });
    } finally {
      setOrgsLoading(false);
    }
  }, []);

  const loadDefaultStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/orgs/vertex-oauth");
      const data = await res.json() as { oauthStatus?: VertexStatus; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDefaultStatus(data.oauthStatus ?? null);
    } catch {
      setDefaultStatus(null);
    }
  }, []);

  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await fetch("/api/admin/accounts");
      const data = await res.json() as { accounts?: AccountItem[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAccounts(data.accounts ?? []);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "アカウント一覧を取得できませんでした" });
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => { void loadOrgs(); void loadDefaultStatus(); }, [loadOrgs, loadDefaultStatus]);
  useEffect(() => { if (tab === "accounts") void loadAccounts(); }, [tab, loadAccounts]);

  async function run(task: () => Promise<void>, success: string, after?: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      await loadDefaultStatus();
      await after?.();
      setMessage({ kind: "success", text: success });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "操作に失敗しました" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 text-gray-900">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-blue-600">サービス管理</p>
            <h1 className="mt-1 text-2xl font-bold">
              {tab === "accounts"
                ? "アカウント"
                : view.name === "new" ? "組織を登録" : view.name === "edit" ? view.org.name : "組織"}
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              {tab === "accounts"
                ? "課金・公開に使うアカウント（プラン、サブドメイン、カスタムドメイン）を管理します。"
                : view.name === "edit"
                  ? `組織ID: ${view.org.id}`
                  : "この画面はサービス管理者専用です。組織の登録と、AI実行に使うVertex AI接続を管理します。"}
            </p>
          </div>
          {tab === "orgs" && (view.name === "list"
            ? <button type="button" className={primaryButton} onClick={() => { setMessage(null); setView({ name: "new" }); }}>New</button>
            : <button type="button" className={secondaryButton} onClick={() => { setMessage(null); setView({ name: "list" }); }}>← 一覧へ</button>)}
        </div>

        <nav className="mb-6 flex gap-1 border-b border-gray-200" aria-label="サービス管理">
          {([["orgs", "組織"], ["accounts", "アカウント"]] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => { setMessage(null); setTab(id); }}
              className={`border-b-2 px-4 py-2 text-sm font-medium ${tab === id ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
            >
              {label}
            </button>
          ))}
        </nav>

        {message && (
          <div className={`mb-4 rounded-lg border p-3 text-sm ${message.kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-800"}`}>
            {message.text}
          </div>
        )}

        {tab === "orgs" && view.name === "list" && (
          <OrganizationList
            orgs={orgs}
            loading={orgsLoading}
            defaultStatus={defaultStatus}
            busy={busy}
            callbackUrl={callbackUrl}
            onEdit={(org) => { setMessage(null); setView({ name: "edit", org }); }}
            run={run}
          />
        )}

        {tab === "orgs" && view.name === "new" && (
          <CreateOrganization
            onCreated={async () => { await loadOrgs(); setView({ name: "list" }); }}
            setMessage={setMessage}
          />
        )}

        {tab === "orgs" && view.name === "edit" && (
          <EditOrganization
            org={view.org}
            busy={busy}
            callbackUrl={callbackUrl}
            run={run}
          />
        )}

        {tab === "accounts" && (
          <AccountsPanel
            accounts={accounts}
            loading={accountsLoading}
            busy={busy}
            run={run}
            reload={loadAccounts}
          />
        )}

        <p className="mt-6 text-center text-xs text-gray-500">ログイン中: {email}</p>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// List + the service-wide default connection
// ---------------------------------------------------------------------------

function OrganizationList({
  orgs,
  loading,
  defaultStatus,
  busy,
  callbackUrl,
  onEdit,
  run,
}: {
  orgs: OrgItem[];
  loading: boolean;
  defaultStatus: VertexStatus | null;
  busy: boolean;
  callbackUrl: string;
  onEdit: (org: OrgItem) => void;
  run: (task: () => Promise<void>, success: string, after?: () => Promise<void>) => Promise<void>;
}) {
  return (
    <div className="space-y-6">
      <section className={cardClass}>
        <h2 className="text-lg font-bold">組織一覧</h2>
        {loading ? (
          <p className="mt-4 text-sm text-gray-500">読み込み中…</p>
        ) : orgs.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">組織がまだありません。「New」から登録してください。</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100">
            {orgs.map((org) => (
              <li key={org.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{org.name}</p>
                  <p className="truncate font-mono text-xs text-gray-500">{org.id}</p>
                </div>
                <button type="button" className={secondaryButton} onClick={() => onEdit(org)}>編集</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cardClass}>
        <h2 className="text-lg font-bold">Vertex AI 既定の接続</h2>
        <p className="mt-2 text-sm text-gray-600">
          すべての組織が既定で使用する接続です。Google Cloudで「ウェブ アプリケーション」用のOAuthクライアントを作成し、
          承認済みリダイレクトURIに
          <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 text-xs">{callbackUrl}</code>
          を登録してからJSONを読み込み、Googleアカウントで接続してください。
        </p>

        <div className="mt-4">
          <StatusLines status={defaultStatus} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className={`cursor-pointer ${secondaryButton} ${busy ? "pointer-events-none opacity-50" : ""}`}>
            OAuthクライアントJSONを選択
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) {
                  void run(
                    async () => vertexApi(await parseOAuthJson(file, callbackUrl)),
                    "既定のOAuthクライアントを保存しました",
                  );
                }
              }}
            />
          </label>
          {defaultStatus?.connected ? (
            <button
              type="button"
              disabled={busy}
              className={secondaryButton}
              onClick={() => void run(() => vertexApi({}, "DELETE"), "既定の連携を解除しました")}
            >
              連携を解除
            </button>
          ) : (
            <a
              href={defaultStatus?.clientConfigured ? "/auth/vertex/start" : undefined}
              aria-disabled={!defaultStatus?.clientConfigured}
              className={`${primaryButton} ${!defaultStatus?.clientConfigured ? "pointer-events-none opacity-50" : ""}`}
            >
              Googleで接続
            </a>
          )}
        </div>
        {!defaultStatus?.clientConfigured && (
          <p className="mt-2 text-xs text-gray-500">先にOAuthクライアントJSONを読み込んでください。</p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New organization
// ---------------------------------------------------------------------------

function CreateOrganization({
  onCreated,
  setMessage,
}: {
  onCreated: () => Promise<void>;
  setMessage: (message: Message | null) => void;
}) {
  const fetcher = useFetcher();
  const [orgId, setOrgId] = useState("");
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const result = fetcher.data as { organization?: { id: string; name: string; ownerEmail: string }; error?: string } | undefined;

  useEffect(() => {
    if (!result) return;
    if (result.error) {
      setMessage({ kind: "error", text: result.error });
      return;
    }
    if (result.organization) {
      setMessage({ kind: "success", text: `組織「${result.organization.name}」を登録しました（管理者: ${result.organization.ownerEmail}）` });
      void onCreated();
    }
    // onCreated/setMessage are stable enough for this one-shot notification.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    fetcher.submit(JSON.stringify({ orgId, name, ownerEmail: ownerEmail.trim() }), {
      method: "POST",
      action: "/api/orgs/create",
      encType: "application/json",
    });
  }

  return (
    <section className={cardClass}>
      <Form onSubmit={submit} className="space-y-5">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">組織名</span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="株式会社サンプル" required />
          <span className="mt-1 block text-xs text-gray-500">画面に表示される名称です。</span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">組織ID</span>
          <input className={`${input} font-mono`} value={orgId} onChange={(e) => setOrgId(e.target.value.toLowerCase())} pattern="[a-z0-9]{6,16}" placeholder="sample01" required />
          <span className="mt-1 block text-xs text-gray-500">半角小文字・数字で6〜16文字。登録後は変更しません。</span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">最初の管理者のメールアドレス</span>
          <input className={input} type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@example.com" required />
          <span className="mt-1 block text-xs text-gray-500">このユーザーが組織設定、AI、予算、メンバーを管理します。</span>
        </label>

        <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
          登録内容：<strong>{name || "組織名"}</strong> の管理者を <strong>{ownerEmail || "メールアドレス"}</strong> に設定
        </div>

        <button type="submit" disabled={fetcher.state !== "idle" || !orgId || !name || !ownerEmail} className={`w-full ${primaryButton}`}>
          {fetcher.state === "idle" ? "組織を登録する" : "登録中…"}
        </button>
      </Form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Edit one organization (Vertex connection)
// ---------------------------------------------------------------------------

function EditOrganization({
  org,
  busy,
  callbackUrl,
  run,
}: {
  org: OrgItem;
  busy: boolean;
  callbackUrl: string;
  run: (task: () => Promise<void>, success: string, after?: () => Promise<void>) => Promise<void>;
}) {
  const [status, setStatus] = useState<OrgVertexStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/orgs/vertex-oauth?orgId=${encodeURIComponent(org.id)}`);
      const data = await res.json() as { oauthStatus?: OrgVertexStatus; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setStatus(data.oauthStatus ?? null);
      setLoadError(null);
    } catch (error) {
      setStatus(null);
      setLoadError(error instanceof Error ? error.message : "状態を取得できませんでした");
    }
  }, [org.id]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  return (
    <section className={cardClass}>
      <h2 className="text-lg font-bold">Vertex AI 接続</h2>
      <p className="mt-2 text-sm text-gray-600">
        既定の接続を継承するか、この組織専用のGoogle Cloudプロジェクトへ接続するかを選べます。切り替えはいつでも可能です。
      </p>

      {loadError && <p className="mt-4 text-sm text-red-700">{loadError}</p>}

      {status && (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || status.source === "default"}
              onClick={() => void run(() => vertexApi({ orgId: org.id, source: "default" }), "既定の接続を使用します", loadStatus)}
              className={`rounded-lg border px-3 py-2 text-sm ${status.source === "default" ? "border-blue-500 bg-blue-50 font-medium text-blue-700" : "border-gray-300 hover:bg-gray-50"}`}
            >
              既定の接続を使う
            </button>
            <button
              type="button"
              disabled={busy || status.source === "own"}
              onClick={() => void run(() => vertexApi({ orgId: org.id, source: "own" }), "この組織専用の接続を使用します", loadStatus)}
              className={`rounded-lg border px-3 py-2 text-sm ${status.source === "own" ? "border-blue-500 bg-blue-50 font-medium text-blue-700" : "border-gray-300 hover:bg-gray-50"}`}
            >
              この組織専用の接続を使う
            </button>
          </div>

          <div className="rounded-lg border border-gray-200 p-4 text-sm">
            <p>
              AI実行に使われる接続:{" "}
              {status.connected
                ? <span className="font-medium text-green-700">{status.connectedEmail}（{status.projectId ?? "プロジェクト未設定"}）</span>
                : <span className="text-gray-500">未接続</span>}
              <span className="ml-2 text-xs text-gray-500">
                {status.source === "default" ? "既定の接続を継承" : "この組織専用"}
              </span>
            </p>
            {status.source === "default" && !status.serviceDefault.connected && (
              <p className="mt-2 text-xs text-amber-700">既定の接続が未設定です。一覧画面の「Vertex AI 既定の接続」で接続してください。</p>
            )}
          </div>

          {status.source === "own" && (
            <>
              <StatusLines status={status} />
              <div className="flex flex-wrap items-center gap-3">
                <label className={`cursor-pointer ${secondaryButton} ${busy ? "pointer-events-none opacity-50" : ""}`}>
                  OAuthクライアントJSONを選択
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) {
                        void run(
                          async () => vertexApi({ orgId: org.id, ...(await parseOAuthJson(file, callbackUrl)) }),
                          "OAuthクライアントを保存しました",
                          loadStatus,
                        );
                      }
                    }}
                  />
                </label>
                {status.connected ? (
                  <button
                    type="button"
                    disabled={busy}
                    className={secondaryButton}
                    onClick={() => void run(() => vertexApi({ orgId: org.id }, "DELETE"), "Google連携を解除しました", loadStatus)}
                  >
                    連携を解除
                  </button>
                ) : (
                  <a
                    href={status.clientConfigured ? `/auth/vertex/start?orgId=${encodeURIComponent(org.id)}` : undefined}
                    aria-disabled={!status.clientConfigured}
                    className={`${primaryButton} ${!status.clientConfigured ? "pointer-events-none opacity-50" : ""}`}
                  >
                    Googleで接続
                  </a>
                )}
              </div>
              {!status.clientConfigured && (
                <p className="text-xs text-gray-500">
                  先にOAuthクライアントJSONを読み込んでください。承認済みリダイレクトURI:{" "}
                  <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">{callbackUrl}</code>
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Accounts (Hubwork billing / publishing records)
// ---------------------------------------------------------------------------

function formatDay(iso: string | undefined): string {
  return iso ? new Date(iso).toLocaleDateString("ja-JP") : "日付不明";
}

const PLAN_LABELS: Record<AccountItem["plan"], string> = {
  lite: "Lite",
  business: "Business",
  granted: "Granted（無償付与）",
};

function AccountsPanel({
  accounts,
  loading,
  busy,
  run,
  reload,
}: {
  accounts: AccountItem[];
  loading: boolean;
  busy: boolean;
  run: (task: () => Promise<void>, success: string, after?: () => Promise<void>) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [newEmail, setNewEmail] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <section className={cardClass}>
        <h2 className="text-lg font-bold">無償付与アカウントを作成</h2>
        <p className="mt-2 text-sm text-gray-600">
          決済を通さずに Business 相当の機能を付与します（plan: granted）。作成後、本人がGoogleでログインするとDrive情報が紐づきます。
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <input
            className={`${input} sm:max-w-sm`}
            type="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            placeholder="user@example.com"
          />
          <button
            type="button"
            className={primaryButton}
            disabled={busy || !newEmail}
            onClick={() => void run(
              async () => { await accountApi({ email: newEmail }); setNewEmail(""); },
              "アカウントを作成しました",
              reload,
            )}
          >
            作成
          </button>
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="text-lg font-bold">アカウント一覧</h2>
        {loading ? (
          <p className="mt-4 text-sm text-gray-500">読み込み中…</p>
        ) : accounts.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">アカウントがありません。</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100">
            {accounts.map((account) => (
              <li key={account.id} className="py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{account.email || "(メール未設定)"}</p>
                    <p className="truncate text-xs text-gray-500">
                      {PLAN_LABELS[account.plan] ?? account.plan} · {account.accountStatus === "enabled" ? "有効" : "停止中"} ·{" "}
                      {account.customDomain || account.defaultDomain || account.accountSlug || "ドメイン未設定"}
                      {account.orgId && <> · 組織 {account.orgId}</>}
                      {account.lifecycle === "read-only" && (
                        <> · 解約済み（エクスポート期限 {formatDay(account.deleteAfter)}）</>
                      )}
                      {account.lifecycle === "expired" && (
                        <> · 保持期間終了（{formatDay(account.deleteAfter)}）— データ削除待ち</>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() => setOpenId((prev) => (prev === account.id ? null : account.id))}
                  >
                    {openId === account.id ? "閉じる" : "編集"}
                  </button>
                </div>
                {openId === account.id && (
                  <AccountEditor account={account} busy={busy} run={run} reload={reload} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AccountEditor({
  account,
  busy,
  run,
  reload,
}: {
  account: AccountItem;
  busy: boolean;
  run: (task: () => Promise<void>, success: string, after?: () => Promise<void>) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [email, setEmail] = useState(account.email);
  const [plan, setPlan] = useState(account.plan);
  const [billingStatus, setBillingStatus] = useState(account.billingStatus);
  const [accountStatus, setAccountStatus] = useState(account.accountStatus);
  const [domainStatus, setDomainStatus] = useState(account.domainStatus);

  return (
    <div className="mt-4 rounded-lg border border-gray-200 p-4">
      <dl className="grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
        <div><dt className="inline font-medium">アカウントID: </dt><dd className="inline font-mono">{account.id}</dd></div>
        <div><dt className="inline font-medium">サブドメイン: </dt><dd className="inline">{account.accountSlug || "—"}</dd></div>
        <div><dt className="inline font-medium">既定ドメイン: </dt><dd className="inline">{account.defaultDomain || "—"}</dd></div>
        <div><dt className="inline font-medium">カスタムドメイン: </dt><dd className="inline">{account.customDomain || "—"}</dd></div>
      </dl>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">メールアドレス</span>
          <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">プラン</span>
          <select className={input} value={plan} onChange={(e) => setPlan(e.target.value as AccountItem["plan"])}>
            {(Object.keys(PLAN_LABELS) as AccountItem["plan"][]).map((value) => (
              <option key={value} value={value}>{PLAN_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">課金状態</span>
          <select className={input} value={billingStatus} onChange={(e) => setBillingStatus(e.target.value as AccountItem["billingStatus"])}>
            <option value="active">active</option>
            <option value="past_due">past_due</option>
            <option value="canceled">canceled</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">アカウント状態</span>
          <select className={input} value={accountStatus} onChange={(e) => setAccountStatus(e.target.value as AccountItem["accountStatus"])}>
            <option value="enabled">enabled</option>
            <option value="disabled">disabled</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">ドメイン状態</span>
          <select className={input} value={domainStatus} onChange={(e) => setDomainStatus(e.target.value as AccountItem["domainStatus"])}>
            <option value="none">none</option>
            <option value="pending_dns">pending_dns</option>
            <option value="provisioning_cert">provisioning_cert</option>
            <option value="active">active</option>
            <option value="failed">failed</option>
          </select>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          className={primaryButton}
          disabled={busy}
          onClick={() => void run(
            () => accountApi({ accountId: account.id, email, plan, billingStatus, accountStatus, domainStatus }),
            "アカウントを更新しました",
            reload,
          )}
        >
          保存
        </button>
        <button
          type="button"
          className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
          disabled={busy || !!account.orgId}
          title={account.orgId ? "組織データとは別に課金レコードだけを削除することはできません" : undefined}
          onClick={() => {
            if (!confirm(`${account.email || account.id} を削除しますか？カスタムドメインも解除されます。`)) return;
            void run(
              () => accountApi({ accountId: account.id }, "DELETE"),
              "アカウントを削除しました",
              reload,
            );
          }}
        >
          {account.orgId ? "組織に紐付いているため削除不可" : "削除"}
        </button>
      </div>
    </div>
  );
}
