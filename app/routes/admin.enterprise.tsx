import { useState } from "react";
import { Form, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/admin.enterprise";
import { getTokens } from "~/services/session.server";
import { isSuperAdmin } from "~/services/super-admin.server";

export async function loader({ request }: Route.LoaderArgs) {
  const tokens = await getTokens(request);
  if (!tokens?.email) throw new Response("not authenticated", { status: 401 });
  if (!isSuperAdmin(tokens.email)) {
    throw new Response("service administrator only", {
      status: 403,
      statusText: "takeshy.work@gmail.com でログインしてください",
    });
  }
  return { email: tokens.email };
}

export default function AdminEnterprise() {
  const { email } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [orgId, setOrgId] = useState("");
  const [name, setName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const result = fetcher.data as { organization?: { id: string; name: string; ownerEmail: string }; error?: string } | undefined;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    fetcher.submit(JSON.stringify({ orgId, name, ownerEmail: ownerEmail.trim() }), {
      method: "POST",
      action: "/api/orgs/create",
      encType: "application/json",
    });
  }

  const input = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 text-gray-900">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <p className="text-sm font-medium text-blue-600">サービス管理</p>
          <h1 className="mt-1 text-2xl font-bold">組織を登録</h1>
          <p className="mt-2 text-sm text-gray-600">
            この画面はサービス管理者専用です。組織と最初の管理者を登録します。
            登録後の設定は各組織の管理者がSettingsから行います。
          </p>
        </div>

        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
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

            <button type="submit" disabled={fetcher.state !== "idle" || !orgId || !name || !ownerEmail} className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              {fetcher.state === "idle" ? "組織を登録する" : "登録中…"}
            </button>
          </Form>

          {result?.error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{result.error}</div>}
          {result?.organization && (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              <p className="font-semibold">組織を登録しました</p>
              <p className="mt-1">{result.organization.name}（{result.organization.id}）</p>
              <p>管理者: {result.organization.ownerEmail}</p>
              <p className="mt-2">管理者はログイン後、<a className="font-medium underline" href="/settings?tab=enterprise">Settings → 組織管理</a> から設定できます。</p>
            </div>
          )}
        </section>

        <p className="mt-4 text-center text-xs text-gray-500">ログイン中: {email}</p>
      </div>
    </main>
  );
}
