import { LogIn, MessageSquare, MessagesSquare, Search, Puzzle, GitBranch, Shield, User, HardDrive, Lock, ServerCog, Github, Globe, Zap, BookOpen } from "lucide-react";
import type { ComponentType } from "react";
import { useLocation } from "react-router";
import type { Language } from "~/types/settings";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";

interface Feature {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
}

interface Screenshot {
  src: string;
  alt: string;
}

interface DataCard {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
}

interface LpStrings {
  tagline: string;
  description: string;
  signIn: string;
  features: Feature[];
  screenshotsTitle: string;
  screenshots: Screenshot[];
  dataUsageTitle: string;
  dataUsageIntro: string;
  dataCards: DataCard[];
  pluginShowcaseTitle: string;
  pluginShowcaseDescription: string;
  pluginShowcaseInstall: string;
  pluginShowcaseLink: string;
  dataUsageLearnMore: string;
  privacyPolicy: string;
  ctaReady: string;
  footerTerms: string;
  footerPolicy: string;
  footerContact: string;
}

const en: LpStrings = {
  tagline: "Note it down. Research it. Automate it.",
  description: "Capture ideas instantly. AI researches the web, reads your files, and answers questions. Automate routine tasks with workflows. All data stays in your Drive.",
  signIn: "Sign in with Google",
  features: [
    { icon: MessageSquare, title: "AI Chat", description: "Upload images or files to ask questions, or generate images. AI answers using Google Search and your Drive files." },
    { icon: Search, title: "Ask Your Files", description: "Semantic search across your Drive files. Search for \"meeting\" and get results mentioning \"conference\" too." },
    { icon: BookOpen, title: "Notes & Editor", description: "Jot down notes in Markdown. Save ideas and meeting notes straight to Drive." },
    { icon: GitBranch, title: "Workflows", description: "Just describe what you want and AI builds an automation workflow. Integrates with Drive, HTTP, and external services." },
    { icon: Puzzle, title: "Plugins", description: "Install extensions from GitHub. Plugins can use AI and Drive operations, enabling advanced automation and custom tools." },
    { icon: Globe, title: "One-Click Publishing", description: "Turn any Drive file into a public web page. Share via URL with no hosting required." },
    { icon: Zap, title: "Works Offline", description: "Files are cached in your browser for instant access. Edit offline, sync to Drive when you're back." },
    { icon: Shield, title: "Your Data, Your Control", description: "No external database. Everything stored in your Google Drive. Supports encryption and self-hosting." },
  ],
  screenshotsTitle: "See It in Action",
  screenshots: [
    { src: "/images/cap.png", alt: "AI Chat & File Management" },
    { src: "/images/visual_workflow.png", alt: "Workflow Builder" },
    { src: "/images/workflow_execution.png", alt: "Workflow Execution" },
    { src: "/images/ai_generate_workflow.png", alt: "AI Workflow Generation" },
    { src: "/images/edit_workflow.png", alt: "Workflow Node Editing" },
    { src: "/images/push_pull.png", alt: "Push/Pull Sync" },
    { src: "/images/pubish_web.png", alt: "One-Click Publishing" },
  ],
  dataUsageTitle: "How We Handle Your Data",
  dataUsageIntro: "GemiHub uses your Google account to sign in. Here's what we access and why:",
  dataCards: [
    { icon: User, title: "Google Account", description: "Your name and email are used only for sign-in and display within the app." },
    { icon: HardDrive, title: "Google Drive", description: "Chat history, workflows, and settings are stored in a dedicated \"gemihub\" folder on your Drive. Files outside the app are never accessed." },
    { icon: Lock, title: "No Third-Party Sharing", description: "Your data is never sold or shared. Everything stays in your own Google Drive." },
    { icon: ServerCog, title: "Fully Portable", description: "No database — all data lives in your Drive. If this service shuts down, just run your own instance and everything is right where you left it." },
  ],
  pluginShowcaseTitle: "Plugin Showcase",
  pluginShowcaseDescription: "A debate plugin where multiple AIs discuss a topic from different perspectives. You can also participate as a debater.",
  pluginShowcaseInstall: "Install from Settings > Plugins with:",
  pluginShowcaseLink: "View on GitHub",
  dataUsageLearnMore: "Learn more in our",
  privacyPolicy: "Privacy Policy",
  ctaReady: "Ready to get started?",
  footerTerms: "Terms of Service",
  footerPolicy: "Privacy Policy",
  footerContact: "Contact",
};

const ja: LpStrings = {
  tagline: "メモして、調べて、自動化する",
  description: "思いついたらすぐメモ。AIがWebを調べてまとめ、ファイルを読み解いて回答し、定型作業を自動でこなす。データはすべてあなたのDrive上に。",
  signIn: "Googleでサインイン",
  features: [
    { icon: MessageSquare, title: "AIチャット", description: "画像やファイルをアップロードして質問したり、画像を生成したり。Google検索やDriveの資料も活用して回答します。" },
    { icon: Search, title: "ファイルに質問", description: "Driveの資料を意味ベースで検索。「打ち合わせ」で調べれば「ミーティング」の内容もヒットします。" },
    { icon: BookOpen, title: "メモ・エディタ", description: "Markdownでさっとメモ。アイデアや議事録をそのままDriveに保存できます。" },
    { icon: GitBranch, title: "ワークフロー", description: "やりたいことを言葉で伝えるだけでAIが自動化ワークフローを作成。Drive・HTTP・外部サービスとの連携も。" },
    { icon: Puzzle, title: "プラグイン", description: "GitHubから機能を追加。プラグインからAIやDrive操作を呼び出せるので、本格的な自動化や独自ツールの構築も可能です。" },
    { icon: Globe, title: "ワンクリック公開", description: "DriveのファイルをそのままWebページに。ホスティング不要でURLを共有できます。" },
    { icon: Zap, title: "オフラインでも快適", description: "ファイルはブラウザにキャッシュされ即座に表示。オフラインでも編集でき、後からDriveに同期。" },
    { icon: Shield, title: "データは自分の手に", description: "外部データベースなし。すべてあなたのGoogle Driveに保存。暗号化やセルフホストにも対応。" },
  ],
  screenshotsTitle: "動作イメージ",
  screenshots: [
    { src: "/images/cap.png", alt: "AIチャット＆ファイル管理" },
    { src: "/images/visual_workflow.png", alt: "ワークフロービルダー" },
    { src: "/images/workflow_execution.png", alt: "ワークフロー実行" },
    { src: "/images/ai_generate_workflow.png", alt: "AIワークフロー生成" },
    { src: "/images/edit_workflow.png", alt: "ワークフローノード編集" },
    { src: "/images/push_pull.png", alt: "Push/Pull同期" },
    { src: "/images/pubish_web.png", alt: "ワンクリック公開" },
  ],
  dataUsageTitle: "データの取り扱いについて",
  dataUsageIntro: "GemiHubはGoogleアカウントでサインインします。アクセスするデータとその理由は以下のとおりです：",
  dataCards: [
    { icon: User, title: "Googleアカウント", description: "名前とメールアドレスは、サインインとアプリ内の表示にのみ使用します。" },
    { icon: HardDrive, title: "Google Drive", description: "チャット履歴・ワークフロー・設定はDrive内の専用フォルダ「gemihub」に保存。アプリ外のファイルにはアクセスできません。" },
    { icon: Lock, title: "第三者への共有なし", description: "データの販売や第三者への共有は一切ありません。すべてご自身のDriveに保存されます。" },
    { icon: ServerCog, title: "完全なポータビリティ", description: "データベースなし。すべてDriveに保存されているので、サービスが停止しても自分でインスタンスを立ち上げればそのまま使えます。" },
  ],
  pluginShowcaseTitle: "プラグイン紹介",
  pluginShowcaseDescription: "複数のAIがテーマについてそれぞれの視点で議論するディベートプラグイン。ユーザーも参加できます。",
  pluginShowcaseInstall: "Settings > Plugins からインストール:",
  pluginShowcaseLink: "GitHubで見る",
  dataUsageLearnMore: "詳しくは",
  privacyPolicy: "プライバシーポリシー",
  ctaReady: "さあ、始めましょう",
  footerTerms: "利用規約",
  footerPolicy: "プライバシーポリシー",
  footerContact: "お問い合わせ",
};

export default function LandingPage() {
  const { pathname } = useLocation();
  const lang: Language = pathname.endsWith("/ja") ? "ja" : "en";
  const s = lang === "ja" ? ja : en;
  const jaPrefix = lang === "ja" ? "/ja" : "";

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {/* Language switcher */}
      <div className="absolute right-4 top-4 z-10">
        <LanguageSwitcher lang={lang} basePath="/lp" />
      </div>

      {/* Hero */}
      <section className="flex flex-col items-center px-4 pb-16 pt-20 text-center sm:pt-28">
        <img
          src="/icons/icon-192x192.png"
          alt="GemiHub"
          width={80}
          height={80}
          className="mb-6 rounded-2xl shadow-lg"
        />
        <h1 className="mb-4 text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-50 sm:text-5xl">
          GemiHub
        </h1>
        <p className="mx-auto mb-3 max-w-2xl text-lg text-gray-600 dark:text-gray-300 sm:text-xl">
          {s.tagline}
        </p>
        <p className="mx-auto mb-10 max-w-2xl text-sm text-gray-500 dark:text-gray-400 sm:text-base">
          {s.description}
        </p>
        <a
          href="/auth/google"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-3.5 text-lg font-semibold text-white shadow-md transition-colors hover:bg-blue-700"
        >
          <LogIn size={22} />
          {s.signIn}
        </a>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {s.features.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="rounded-xl border border-gray-200 bg-gray-50 p-6 dark:border-gray-800 dark:bg-gray-900"
            >
              <Icon size={28} className="mb-3 text-blue-600 dark:text-blue-400" />
              <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                {title}
              </h3>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Plugin Showcase */}
      <section className="mx-auto max-w-4xl px-4 pb-20">
        <h2 className="mb-8 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
          {s.pluginShowcaseTitle}
        </h2>
        <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          <img
            src="/images/ronginus.png"
            alt="Ronginus"
            className="w-full"
            loading="lazy"
          />
          <div className="bg-gray-50 p-6 dark:bg-gray-900 sm:flex sm:items-center sm:gap-6">
            <div className="mb-4 flex shrink-0 items-center justify-center sm:mb-0">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-100 dark:bg-purple-900/40">
                <MessagesSquare size={32} className="text-purple-600 dark:text-purple-400" />
              </div>
            </div>
            <div className="flex-1">
              <h3 className="mb-1.5 text-lg font-semibold text-gray-900 dark:text-gray-100">
                Ronginus
              </h3>
              <p className="mb-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {s.pluginShowcaseDescription}
              </p>
              <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
                {s.pluginShowcaseInstall}{" "}
                <code className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-mono text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                  takeshy/hub-ronginus
                </code>
              </p>
              <a
                href="https://github.com/takeshy/hub-ronginus"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
              >
                <Github size={16} />
                {s.pluginShowcaseLink}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Screenshots */}
      <section className="mx-auto max-w-5xl px-4 pb-20">
        <h2 className="mb-10 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
          {s.screenshotsTitle}
        </h2>
        <div className="space-y-10">
          {s.screenshots.map(({ src, alt }) => (
            <figure key={src} className="overflow-hidden rounded-xl border border-gray-200 shadow-lg dark:border-gray-800">
              <img
                src={src}
                alt={alt}
                className="w-full"
                loading="lazy"
              />
              <figcaption className="bg-gray-50 px-4 py-2.5 text-center text-sm text-gray-600 dark:bg-gray-900 dark:text-gray-400">
                {alt}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* Data Usage */}
      <section className="mx-auto max-w-4xl px-4 pb-20">
        <h2 className="mb-4 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
          {s.dataUsageTitle}
        </h2>
        <p className="mb-8 text-center text-sm text-gray-600 dark:text-gray-400">
          {s.dataUsageIntro}
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          {s.dataCards.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-900">
              <Icon size={24} className="mb-2 text-green-600 dark:text-green-400" />
              <h3 className="mb-1.5 text-base font-semibold text-gray-900 dark:text-gray-100">
                {title}
              </h3>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {description}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {s.dataUsageLearnMore}{" "}
          <a href={`/policy${jaPrefix}`} className="text-blue-600 underline hover:text-blue-700 dark:text-blue-400">
            {s.privacyPolicy}
          </a>
        </p>
      </section>

      {/* Footer CTA */}
      <section className="flex flex-col items-center border-t border-gray-200 px-4 py-16 dark:border-gray-800">
        <h2 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-50">
          {s.ctaReady}
        </h2>
        <a
          href="/auth/google"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-3.5 text-lg font-semibold text-white shadow-md transition-colors hover:bg-blue-700"
        >
          <LogIn size={22} />
          {s.signIn}
        </a>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-gray-50 px-4 py-8 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex gap-6">
            <a href={`/terms${jaPrefix}`} className="hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              {s.footerTerms}
            </a>
            <a href={`/policy${jaPrefix}`} className="hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              {s.footerPolicy}
            </a>
            <a href="https://github.com/takeshy/gemihub" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              <Github size={14} />
              GitHub
            </a>
            <a href={`https://github.com/takeshy/gemihub/blob/main/${lang === "ja" ? "README_ja.md" : "README.md"}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              <BookOpen size={14} />
              README
            </a>
            <a href="mailto:takeshy.work@gmail.com" className="hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              {s.footerContact}
            </a>
          </div>
          <p>&copy; {new Date().getFullYear()} <a href="https://takeshy.work" className="hover:text-gray-700 hover:underline dark:hover:text-gray-200">takeshy.work</a></p>
        </div>
      </footer>
    </div>
  );
}
