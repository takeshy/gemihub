import { Link, useLoaderData, useSearchParams } from "react-router";
import { KeyRound, Mail } from "lucide-react";
import type { Route } from "./+types/login";
import { resolveLanguage } from "~/i18n/resolve-language";

const STRINGS = {
  en: {
    title: "Sign in",
    subtitle: "Choose how you want to sign in.",
    workspacePending:
      "You've joined the organization. The project workspace is being prepared — sign in with Google to start right away.",
    emailTitle: "Email",
    emailAudience: "For invited members",
    emailDesc:
      "Sign in from the \"Join the team\" button in your invitation email. No Google account link is required.",
    googleTitle: "Google Login",
    googleAudience: "For Owners",
    googleDesc:
      "Owners use this for initial organization setup and Google service integration.",
    googleButton: "Sign in with Google",
  },
  ja: {
    title: "ログイン",
    subtitle: "利用方法に合わせてログイン方法を選んでください。",
    workspacePending:
      "組織への参加は完了しています。組織プロジェクトのワークスペースは現在準備中です。今すぐ利用するには、Googleアカウントでログインしてください。",
    emailTitle: "Email",
    emailAudience: "管理者・メンバー向け",
    emailDesc:
      "招待メールにある「チームに参加する」ボタンからログインします。Googleアカウント連携は不要です。",
    googleTitle: "Google Login",
    googleAudience: "Owner向け",
    googleDesc: "組織の初期設定やGoogleサービス連携を行うOwnerはこちらを使用します。",
    googleButton: "Googleでログイン",
  },
} as const;

export async function loader({ request }: Route.LoaderArgs) {
  const lang = resolveLanguage(null, request.headers.get("Accept-Language"));
  return { lang };
}

export default function LoginPage() {
  const { lang } = useLoaderData<typeof loader>();
  const s = STRINGS[lang] ?? STRINGS.en;
  const [searchParams] = useSearchParams();
  const workspacePending = searchParams.get("workspace") === "pending";
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-white to-violet-50 px-5 py-10 dark:from-gray-950 dark:via-gray-900 dark:to-blue-950">
      <section className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-7 shadow-xl shadow-blue-950/5 dark:border-gray-700 dark:bg-gray-900 sm:p-9">
        <Link to="/lp" className="mb-8 flex items-center justify-center gap-3">
          <img src="/icons/icon-192x192.png" alt="" className="h-11 w-11 rounded-xl" />
          <span className="text-xl font-bold text-gray-900 dark:text-white">GemiHub</span>
        </Link>
        <h1 className="text-center text-2xl font-bold text-gray-900 dark:text-white">{s.title}</h1>
        {workspacePending && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {s.workspacePending}
          </div>
        )}
        <p className="mt-2 text-center text-sm leading-6 text-gray-500 dark:text-gray-400">{s.subtitle}</p>

        <div className="mt-7 space-y-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-5 dark:border-blue-900 dark:bg-blue-950/20">
            <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"><Mail size={20} /></span><div><h2 className="font-semibold text-gray-900 dark:text-white">{s.emailTitle}</h2><p className="text-xs text-gray-500 dark:text-gray-400">{s.emailAudience}</p></div></div>
            <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">{s.emailDesc}</p>
          </div>

          <div className="rounded-xl border border-gray-200 p-5 dark:border-gray-700">
            <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"><KeyRound size={20} /></span><div><h2 className="font-semibold text-gray-900 dark:text-white">{s.googleTitle}</h2><p className="text-xs text-gray-500 dark:text-gray-400">{s.googleAudience}</p></div></div>
            <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">{s.googleDesc}</p>
            <a href="/auth/google" className="mt-4 flex w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700">{s.googleButton}</a>
          </div>
        </div>
      </section>
    </main>
  );
}
