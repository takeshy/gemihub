import { LogIn, MessageSquare, MessagesSquare, Search, Puzzle, GitBranch, Shield, User, HardDrive, Lock, ServerCog, Github, Globe, Zap, BookOpen, Bot, Wrench, Cloud } from "lucide-react";
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
  description: string;
}

interface DataCard {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
}

interface AgenticPoint {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
}

interface LpStrings {
  tagline: string;
  description: string;
  signIn: string;
  agenticTitle: string;
  agenticIntro: string;
  agenticPoints: AgenticPoint[];
  features: Feature[];
  screenshotsTitle: string;
  screenshots: Screenshot[];
  techStackTitle: string;
  techStackAi: string;
  techStackCompute: string;
  techStackStorage: string;
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
  tagline: "AI that works for you, right inside Google Drive.",
  description: "GemiHub is an AI assistant that reads your files, finds what you need, and gets things done on its own. Connect external tools, search across your documents by meaning, and automate repetitive tasks — all while keeping your data in your own Google Drive.",
  signIn: "Sign in with Google",
  agenticTitle: "AI That Acts, Not Just Answers",
  agenticIntro: "Most AI chatbots wait for you to copy-paste information. GemiHub's AI thinks for itself — it picks the right tool and takes action without you lifting a finger.",
  agenticPoints: [
    { icon: Wrench, title: "Picks Its Own Tools", description: "Ask a question and the AI figures out what to do: read a file, search your Drive, look things up on the web, or call an external service. You just ask — it handles the rest." },
    { icon: Search, title: "Searches by Meaning", description: "Your files are indexed so the AI can find relevant information even when the exact words don't match. Ask \"when was the budget meeting?\" and it finds your \"Q3 finance review\" notes." },
    { icon: Bot, title: "Connects to Outside Tools", description: "Hook up web search, databases, or any compatible service. The AI automatically discovers what's available and uses it during your conversation." },
    { icon: GitBranch, title: "Runs Multi-Step Tasks", description: "String together AI prompts, file edits, web requests, and more into automated workflows. Or just tell the AI what you want and it builds the workflow for you." },
  ],
  features: [
    { icon: MessageSquare, title: "AI Chat", description: "Have a conversation with AI that can read your files, search the web, generate images, and use external tools — all on its own." },
    { icon: Search, title: "Ask Your Files", description: "Search your Drive files by meaning, not just keywords. Search for \"meeting\" and get results mentioning \"conference\" too." },
    { icon: BookOpen, title: "Notes & Editor", description: "Jot down notes in Markdown. Save ideas and meeting notes straight to Drive." },
    { icon: GitBranch, title: "Workflows", description: "Just describe what you want and AI builds an automation workflow. Works with Drive, the web, and external services." },
    { icon: Puzzle, title: "Plugins", description: "Add new features from GitHub. Plugins can use AI and Drive, so you can build custom tools and advanced automation." },
    { icon: Globe, title: "One-Click Publishing", description: "Turn any Drive file into a public web page. Share via URL with no hosting required." },
    { icon: Zap, title: "Works Offline", description: "All files cached in your browser for instant access — even without internet. Edit offline, then push changes to Drive with one click. Conflicts are detected automatically." },
    { icon: Shield, title: "Your Data, Your Control", description: "No external database. Everything stored in your Google Drive. Supports encryption and self-hosting." },
  ],
  screenshotsTitle: "See It in Action",
  screenshots: [
    { src: "/images/cap.png", alt: "AI Chat & File Management", description: "Write notes in a rich editor and let AI proofread or summarize them. Chat with web search, file search by meaning, image generation, and connections to external tools." },
    { src: "/images/visual_workflow.png", alt: "Workflow Builder", description: "Build automation with a drag-and-drop editor. Connect AI prompts, Drive operations, and web requests into a single flow." },
    { src: "/images/ai_generate_workflow.png", alt: "AI Workflow Generation", description: "Describe what you want in plain language and AI creates the workflow for you, with a live preview." },
    { src: "/images/rag_search.png", alt: "Smart File Search", description: "Sync your Drive files to meaning-based search. Ask questions naturally and get answers drawn from your own documents." },
    { src: "/images/push_pull.png", alt: "Push/Pull Sync", description: "All data lives in your Google Drive. Push and pull changes with automatic conflict handling." },
    { src: "/images/pubish_web.png", alt: "One-Click Publishing", description: "Turn any Drive file into a public web page. Share via URL with no hosting required." },
  ],
  techStackTitle: "Built with Google Cloud",
  techStackAi: "Gemini API — AI chat, tool use, thinking, image generation, and smart file search (RAG)",
  techStackCompute: "Cloud Run — App hosting that scales automatically, with Cloud Build for continuous deployment",
  techStackStorage: "Google Drive API — All your data stored in your own Drive, no separate database needed",
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
  tagline: "AIがあなたの代わりに動く。Google Drive と一緒に。",
  description: "GemiHub は、ファイルを読んで、必要な情報を探して、作業までこなしてくれる AI アシスタントです。外部ツールとの連携、ドキュメント横断の意味検索、繰り返し作業の自動化まで。データはすべてあなたの Google Drive に保存されます。",
  signIn: "Googleでサインイン",
  agenticTitle: "答えるだけじゃない、動く AI",
  agenticIntro: "普通の AI チャットは、あなたが情報をコピペして渡す必要があります。GemiHub の AI は自分で考えて、自分で動きます。",
  agenticPoints: [
    { icon: Wrench, title: "必要な道具を自分で選ぶ", description: "質問すると、AI が自分で判断してファイルを読んだり、Drive を検索したり、Web で調べたり、外部サービスに問い合わせたり。あなたは聞くだけ。" },
    { icon: Search, title: "「意味」で探してくれる", description: "ファイルの中身を意味で検索できます。「予算の会議いつだっけ？」と聞けば、「Q3 財務レビュー」のメモを見つけてきます。" },
    { icon: Bot, title: "外部ツールも自動で使う", description: "Web 検索やデータベースなどの外部サービスをつなぐだけ。AI が会話の中で必要なツールを見つけて、勝手に使ってくれます。" },
    { icon: GitBranch, title: "複数ステップの作業を自動化", description: "AI への指示、ファイル編集、Web リクエストなどをつなげて自動化。「こういうことがしたい」と伝えれば、AI がワークフローを組み立てます。" },
  ],
  features: [
    { icon: MessageSquare, title: "AIチャット", description: "AI がファイルを読み、Web を調べ、画像を作り、外部ツールまで使って回答。全部おまかせで動きます。" },
    { icon: Search, title: "ファイルに質問", description: "Drive の資料をキーワードではなく「意味」で検索。「打ち合わせ」で調べれば「ミーティング」の内容もヒット。" },
    { icon: BookOpen, title: "メモ・エディタ", description: "Markdownでさっとメモ。アイデアや議事録をそのままDriveに保存できます。" },
    { icon: GitBranch, title: "ワークフロー", description: "やりたいことを言葉で伝えるだけでAIが自動化ワークフローを作成。Drive や Web、外部サービスとも連携。" },
    { icon: Puzzle, title: "プラグイン", description: "GitHubから機能を追加。AI や Drive と連携できるので、自分だけのツールや高度な自動化も構築できます。" },
    { icon: Globe, title: "ワンクリック公開", description: "DriveのファイルをそのままWebページに。ホスティング不要でURLを共有できます。" },
    { icon: Zap, title: "オフラインでも快適", description: "すべてのファイルがブラウザにキャッシュされ、ネットがなくても即座にアクセス。オフラインで編集して、ワンクリックでDriveに同期。コンフリクトも自動検出。" },
    { icon: Shield, title: "データは自分の手に", description: "外部データベースなし。すべてあなたのGoogle Driveに保存。暗号化やセルフホストにも対応。" },
  ],
  screenshotsTitle: "動作イメージ",
  screenshots: [
    { src: "/images/cap.png", alt: "AIチャット＆ファイル管理", description: "エディターでメモを書いて、AI に校正や要約をおまかせ。チャットでは Web 検索、ファイルの意味検索、画像生成、外部ツール連携も。" },
    { src: "/images/visual_workflow.png", alt: "ワークフロービルダー", description: "ドラッグ＆ドロップで自動化を構築。AI への指示、Drive 操作、Web リクエストをひとつの流れに。" },
    { src: "/images/ai_generate_workflow.png", alt: "AIワークフロー生成", description: "やりたいことを言葉で伝えるだけで AI がワークフローを作成。リアルタイムでプレビューも確認できます。" },
    { src: "/images/rag_search.png", alt: "かしこいファイル検索", description: "Drive のファイルを意味で検索できるように同期。自然な言葉で質問すれば、あなたの資料から答えを見つけます。" },
    { src: "/images/push_pull.png", alt: "Push/Pull同期", description: "すべてのデータは Google Drive に保存。変更の同期も、ぶつかった時の解決もかんたん。" },
    { src: "/images/pubish_web.png", alt: "ワンクリック公開", description: "DriveのファイルをそのままWebページに。ホスティング不要でURLを共有。" },
  ],
  techStackTitle: "Google Cloud で構築",
  techStackAi: "Gemini API — AI チャット、ツール自動選択、思考表示、画像生成、ファイル意味検索（RAG）",
  techStackCompute: "Cloud Run — アクセスに応じて自動でスケールするアプリ実行基盤。Cloud Build で自動デプロイ",
  techStackStorage: "Google Drive API — すべてのデータをユーザー自身の Drive に保存。外部データベースは不要",
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

      {/* Agentic AI */}
      <section className="mx-auto max-w-5xl px-4 pb-20">
        <h2 className="mb-4 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
          {s.agenticTitle}
        </h2>
        <p className="mx-auto mb-10 max-w-2xl text-center text-sm text-gray-500 dark:text-gray-400 sm:text-base">
          {s.agenticIntro}
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          {s.agenticPoints.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="rounded-xl border border-purple-200 bg-purple-50 p-6 dark:border-purple-900 dark:bg-purple-950/40"
            >
              <Icon size={28} className="mb-3 text-purple-600 dark:text-purple-400" />
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

      {/* Screenshots */}
      <section className="mx-auto max-w-5xl px-4 pb-20">
        <h2 className="mb-10 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
          {s.screenshotsTitle}
        </h2>
        {/* Hero screenshot */}
        {s.screenshots.length > 0 && (
          <figure className="mb-6 overflow-hidden rounded-xl border border-gray-200 shadow-lg dark:border-gray-800">
            <img
              src={s.screenshots[0].src}
              alt={s.screenshots[0].alt}
              className="w-full"
              loading="lazy"
            />
            <figcaption className="bg-gray-50 px-4 py-3 dark:bg-gray-900">
              <p className="text-center text-sm font-semibold text-gray-900 dark:text-gray-100">{s.screenshots[0].alt}</p>
              <p className="mt-1 text-center text-sm leading-relaxed text-gray-600 dark:text-gray-400">{s.screenshots[0].description}</p>
            </figcaption>
          </figure>
        )}
        {/* Rest in grid */}
        <div className="grid gap-6 sm:grid-cols-2">
          {s.screenshots.slice(1).map(({ src, alt, description }) => (
            <figure key={src} className="overflow-hidden rounded-xl border border-gray-200 shadow-lg dark:border-gray-800">
              <img
                src={src}
                alt={alt}
                className="w-full"
                loading="lazy"
              />
              <figcaption className="bg-gray-50 px-4 py-3 dark:bg-gray-900">
                <p className="text-center text-xs font-semibold text-gray-900 dark:text-gray-100">{alt}</p>
                <p className="mt-1 text-center text-xs leading-relaxed text-gray-600 dark:text-gray-400">{description}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* Tech Stack */}
      <section className="mx-auto max-w-4xl px-4 pb-20">
        <h2 className="mb-8 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
          {s.techStackTitle}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: Bot, label: "AI", text: s.techStackAi },
            { icon: Cloud, label: "Compute", text: s.techStackCompute },
            { icon: HardDrive, label: "Storage", text: s.techStackStorage },
          ].map(({ icon: Icon, label, text }) => (
            <div key={label} className="rounded-xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-900 dark:bg-blue-950/40">
              <Icon size={24} className="mb-2 text-blue-600 dark:text-blue-400" />
              <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Plugin Showcase */}
      <section className="mx-auto max-w-3xl px-4 pb-20">
        <h2 className="mb-8 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
          {s.pluginShowcaseTitle}
        </h2>
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800 sm:flex">
          <div className="shrink-0 sm:w-64">
            <img
              src="/images/ronginus.png"
              alt="Ronginus"
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="flex flex-1 items-center gap-4 bg-gray-50 p-6 dark:bg-gray-900">
            <div className="hidden shrink-0 sm:block">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-100 dark:bg-purple-900/40">
                <MessagesSquare size={28} className="text-purple-600 dark:text-purple-400" />
              </div>
            </div>
            <div className="flex-1">
              <h3 className="mb-1.5 text-lg font-semibold text-gray-900 dark:text-gray-100">
                Ronginus
              </h3>
              <p className="mb-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
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
