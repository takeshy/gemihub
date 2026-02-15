import { LogIn, MessageSquare, MessagesSquare, Search, Puzzle, GitBranch, Shield, User, HardDrive, Lock, ServerCog, Github, Globe, Zap, BookOpen, Bot, Wrench, Cloud, Sparkles, Code, AlertTriangle, ExternalLink } from "lucide-react";
import type { ComponentType } from "react";
import { useLocation } from "react-router";
import type { Language } from "~/types/settings";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";

export function headers() {
  return {
    "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400, max-age=3600",
  };
}

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
  aiProTitle: string;
  aiProIntro: string;
  aiProPricing: string;
  aiProRegionUs: string;
  aiProRegionJp: string;
  aiProMonthly: string;
  aiProAnnual: string;
  aiProAiFeatures: string;
  aiProAiFeaturesDesc: string;
  aiProStorage: string;
  aiProStorageDesc: string;
  aiProDevBenefits: string;
  aiProDevBenefitsDesc: string;
  aiProWorthIt: string;
  aiProWorthItDesc: string;
  aiProActivateTitle: string;
  aiProActivateSteps: string[];
  aiProApiUsageTitle: string;
  aiProFlashTitle: string;
  aiProFlashSub: string;
  aiProFlashDesc: string;
  aiProProTitle: string;
  aiProProSub: string;
  aiProProDesc: string;
  aiProRagTitle: string;
  aiProRagSub: string;
  aiProRagDesc: string;
  aiProApiUsageSummary: string;
  aiProReferences: string;
  dataUsageLearnMore: string;
  privacyPolicy: string;
  heroManual: string;
  ctaReady: string;
  footerTerms: string;
  footerPolicy: string;
  footerManual: string;
  footerContact: string;
}

const en: LpStrings = {
  tagline: "AI That Acts, Not Just Answers",
  description: "GemiHub is an AI assistant that reads your files, finds what you need, and gets things done on its own. Connect external tools, search across your documents by meaning, and automate repetitive tasks — all while keeping your data in your own Google Drive.",
  signIn: "Sign in with Google",
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
    { src: "/images/chat_mcp_apps.png", alt: "MCP Apps", description: "Connect external apps via MCP (Model Context Protocol). The AI discovers available tools automatically and uses them in your conversation — calendars, databases, and more." },
    { src: "/images/visual_workflow.png", alt: "Workflow Builder", description: "Build automation with a drag-and-drop editor. Connect AI prompts, Drive operations, and web requests into a single flow." },
    { src: "/images/ai_generate_workflow.png", alt: "AI Workflow Generation", description: "Describe what you want in plain language and AI creates the workflow for you, with a live preview." },
    { src: "/images/rag_search.png", alt: "Smart File Search", description: "Sync your Drive files to meaning-based search. Ask questions naturally and get answers drawn from your own documents." },
    { src: "/images/pull_diff.png", alt: "Push/Pull Sync", description: "All data lives in your Google Drive. Push and pull changes with automatic conflict handling." },
    { src: "/images/publish_web.png", alt: "One-Click Publishing", description: "Turn any Drive file into a public web page. Share via URL with no hosting required." },
  ],
  techStackTitle: "Built with Google Cloud",
  techStackAi: "Gemini API — AI chat, tool use, thinking, image generation, and smart file search (RAG)",
  techStackCompute: "Cloud Run — App hosting that scales automatically, with Cloud Build for continuous deployment",
  techStackStorage: "Google Drive API — All your data stored in your own Drive, no separate database needed",
  dataUsageTitle: "How We Handle Your Data",
  dataUsageIntro: "GemiHub uses your Google account to sign in. Here's what we access and why:",
  dataCards: [
    { icon: User, title: "Google Account", description: "Your Google account is used only for authentication. Your name and email are not stored or displayed." },
    { icon: HardDrive, title: "Google Drive", description: "Chat history, workflows, and settings are stored in a dedicated \"gemihub\" folder on your Drive. Files outside the app are never accessed." },
    { icon: Lock, title: "No Third-Party Sharing", description: "Your data is never sold or shared. Everything stays in your own Google Drive." },
    { icon: ServerCog, title: "Fully Portable", description: "No database — all data lives in your Drive. If this service shuts down, just run your own instance and everything is right where you left it." },
  ],
  pluginShowcaseTitle: "Plugin Showcase",
  pluginShowcaseDescription: "A debate plugin where multiple AIs discuss a topic from different perspectives. You can also participate as a debater.",
  pluginShowcaseInstall: "Install from Settings > Plugins with:",
  pluginShowcaseLink: "View on GitHub",
  aiProTitle: "Google AI Pro: More Value for Gemini Users",
  aiProIntro: "GemiHub uses the Gemini API. If you subscribe to Google AI Pro, the included cloud credits can cover your API costs — making GemiHub essentially free to run.",
  aiProPricing: "Pricing",
  aiProRegionUs: "United States",
  aiProRegionJp: "Japan",
  aiProMonthly: "/month",
  aiProAnnual: "/year",
  aiProAiFeatures: "AI Features",
  aiProAiFeaturesDesc: "Gemini 3 Pro, Workspace AI (Docs, Sheets, Gmail), image & video generation, 1,000 credits/month, NotebookLM Plus, family sharing (up to 5)",
  aiProStorage: "Storage & Extras",
  aiProStorageDesc: "2 TB Google One storage, Google Home Premium",
  aiProDevBenefits: "Developer Benefits",
  aiProDevBenefitsDesc: "$10/month Google Cloud credits, Gemini Code Assist, Gemini CLI, Firebase Studio (30 workspaces)",
  aiProWorthIt: "Is It Worth It?",
  aiProWorthItDesc: "2 TB Google One alone costs $9.99/month. Add the $10 cloud credit and the extra cost for AI Pro is effectively ~$0. You get Gemini 3 Pro, Workspace AI, and developer tools on top — for free.",
  aiProActivateTitle: "Important: Activate Your Developer Credits",
  aiProActivateSteps: [
    "Subscribe to Google AI Pro",
    "Open Google Cloud Console (console.cloud.google.com)",
    "Link your billing account to a project",
    "Verify credits appear under Billing → Credits",
  ],
  aiProApiUsageTitle: "What Can $10/Month Cover?",
  aiProFlashTitle: "Gemini 3 Flash",
  aiProFlashSub: "Fast & Low Cost",
  aiProFlashDesc: "Input: ~20–40M tokens. Output: ~3M tokens. For personal development and data analysis, this is practically unlimited — even processing hundreds of books barely scratches the surface.",
  aiProProTitle: "Gemini 3 Pro",
  aiProProSub: "High Intelligence & Complex Reasoning",
  aiProProDesc: "Input: ~4–5M tokens. Output: ~800K–1M tokens. More expensive than Flash, but still enough for thousands of standard chat round-trips.",
  aiProRagTitle: "File Search (RAG)",
  aiProRagSub: "Index & Search Your Documents",
  aiProRagDesc: "Indexing is extremely cheap — $10 covers tens of millions of tokens (thousands of PDF pages). Retrieval uses standard model pricing; with Flash, the cost is negligible.",
  aiProApiUsageSummary: "With Gemini 3 Flash as your File Search engine, $10/month goes surprisingly far. Build a personal AI librarian from your entire PDF library without worrying about the budget.",
  aiProReferences: "References",
  dataUsageLearnMore: "Learn more in our",
  privacyPolicy: "Privacy Policy",
  heroManual: "Read the Manual",
  ctaReady: "Ready to get started?",
  footerTerms: "Terms of Service",
  footerPolicy: "Privacy Policy",
  footerManual: "Manual",
  footerContact: "Contact",
};

const ja: LpStrings = {
  tagline: "答えるだけじゃない、動く AI",
  description: "GemiHub は、ファイルを読んで、必要な情報を探して、作業までこなしてくれる AI アシスタントです。外部ツールとの連携、ドキュメント横断の意味検索、繰り返し作業の自動化まで。データはすべてあなたの Google Drive に保存されます。",
  signIn: "Googleでサインイン",
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
    { src: "/images/chat_mcp_apps.png", alt: "MCP Apps", description: "MCP（Model Context Protocol）で外部アプリと連携。AI が利用可能なツールを自動で検出し、会話の中でカレンダーやデータベースなどを操作します。" },
    { src: "/images/visual_workflow.png", alt: "ワークフロービルダー", description: "ドラッグ＆ドロップで自動化を構築。AI への指示、Drive 操作、Web リクエストをひとつの流れに。" },
    { src: "/images/ai_generate_workflow.png", alt: "AIワークフロー生成", description: "やりたいことを言葉で伝えるだけで AI がワークフローを作成。リアルタイムでプレビューも確認できます。" },
    { src: "/images/rag_search.png", alt: "かしこいファイル検索", description: "Drive のファイルを意味で検索できるように同期。自然な言葉で質問すれば、あなたの資料から答えを見つけます。" },
    { src: "/images/pull_diff.png", alt: "Push/Pull同期", description: "すべてのデータは Google Drive に保存。変更の同期も、ぶつかった時の解決もかんたん。" },
    { src: "/images/publish_web.png", alt: "ワンクリック公開", description: "DriveのファイルをそのままWebページに。ホスティング不要でURLを共有。" },
  ],
  techStackTitle: "Google Cloud で構築",
  techStackAi: "Gemini API — AI チャット、ツール自動選択、思考表示、画像生成、ファイル意味検索（RAG）",
  techStackCompute: "Cloud Run — アクセスに応じて自動でスケールするアプリ実行基盤。Cloud Build で自動デプロイ",
  techStackStorage: "Google Drive API — すべてのデータをユーザー自身の Drive に保存。外部データベースは不要",
  dataUsageTitle: "データの取り扱いについて",
  dataUsageIntro: "GemiHubはGoogleアカウントでサインインします。アクセスするデータとその理由は以下のとおりです：",
  dataCards: [
    { icon: User, title: "Googleアカウント", description: "Googleアカウントは認証にのみ使用します。名前やメールアドレスの保存・表示は行いません。" },
    { icon: HardDrive, title: "Google Drive", description: "チャット履歴・ワークフロー・設定はDrive内の専用フォルダ「gemihub」に保存。アプリ外のファイルにはアクセスできません。" },
    { icon: Lock, title: "第三者への共有なし", description: "データの販売や第三者への共有は一切ありません。すべてご自身のDriveに保存されます。" },
    { icon: ServerCog, title: "完全なポータビリティ", description: "データベースなし。すべてDriveに保存されているので、サービスが停止しても自分でインスタンスを立ち上げればそのまま使えます。" },
  ],
  pluginShowcaseTitle: "プラグイン紹介",
  pluginShowcaseDescription: "複数のAIがテーマについてそれぞれの視点で議論するディベートプラグイン。ユーザーも参加できます。",
  pluginShowcaseInstall: "Settings > Plugins からインストール:",
  pluginShowcaseLink: "GitHubで見る",
  aiProTitle: "Google AI Pro：Gemini ユーザーにお得なプラン",
  aiProIntro: "GemiHub は Gemini API を利用しています。Google AI Pro に加入すると、付属のクラウドクレジットで API 費用をカバーでき、GemiHub を実質無料で運用できます。",
  aiProPricing: "料金",
  aiProRegionUs: "米国",
  aiProRegionJp: "日本",
  aiProMonthly: "/月",
  aiProAnnual: "/年",
  aiProAiFeatures: "AI 機能",
  aiProAiFeaturesDesc: "Gemini 3 Pro、Workspace AI（Docs, Sheets, Gmail 等）、画像・動画生成、1,000 クレジット/月、NotebookLM Plus、家族共有（5人まで）",
  aiProStorage: "ストレージ & 特典",
  aiProStorageDesc: "2 TB Google One ストレージ、Google Home Premium",
  aiProDevBenefits: "開発者特典",
  aiProDevBenefitsDesc: "月 $10 の Google Cloud クレジット、Gemini Code Assist、Gemini CLI、Firebase Studio（30 ワークスペース）",
  aiProWorthIt: "お得なの？",
  aiProWorthItDesc: "2 TB Google One だけで $9.99/月。さらに $10 のクラウドクレジットが付くので、AI Pro の追加コストは実質 ～$0。Gemini 3 Pro、Workspace AI、開発者ツールがすべておまけで付いてきます。",
  aiProActivateTitle: "重要：開発者クレジットの有効化手順",
  aiProActivateSteps: [
    "Google AI Pro に加入する",
    "Google Cloud Console（console.cloud.google.com）を開く",
    "請求先アカウントをプロジェクトにリンクする",
    "「お支払い」→「クレジット」にクレジットが表示されることを確認",
  ],
  aiProApiUsageTitle: "月 $10 でできること",
  aiProFlashTitle: "Gemini 3 Flash",
  aiProFlashSub: "高速・低コスト",
  aiProFlashDesc: "入力：約 2,000万〜4,000万トークン。出力：約 300万トークン。個人開発やデータ分析では、ほぼ「使い放題」。数百冊分の書籍を読み込ませても使い切るのは困難です。",
  aiProProTitle: "Gemini 3 Pro",
  aiProProSub: "高知能・複雑な推論",
  aiProProDesc: "入力：約 400万〜500万トークン。出力：約 80万〜100万トークン。Flash より高コストですが、標準的なチャットなら数千〜1万回のやり取りが可能です。",
  aiProRagTitle: "File Search（RAG）",
  aiProRagSub: "ドキュメントのインデックス＆検索",
  aiProRagDesc: "インデックス作成は非常に安価 — $10 で数千万トークン（数千〜数万ページ分の PDF）をインデックス化可能。検索は通常のモデル料金で、Flash なら極めて低コスト。",
  aiProApiUsageSummary: "Gemini 3 Flash を検索エンジンとして使えば、月 $10 のクレジットは驚くほど長持ちします。大量の PDF ライブラリから自分専用の AI 司書を構築しても、予算を心配する必要はほとんどありません。",
  aiProReferences: "参考リンク",
  dataUsageLearnMore: "詳しくは",
  privacyPolicy: "プライバシーポリシー",
  heroManual: "マニュアルを読む",
  ctaReady: "さあ、始めましょう",
  footerTerms: "利用規約",
  footerPolicy: "プライバシーポリシー",
  footerManual: "マニュアル",
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
      <section className="bg-white px-4 pb-8 pt-20 text-center dark:bg-gray-950 sm:pt-28">
        <div>
          <img
            src="/icons/icon-192x192.png"
            alt="GemiHub"
            width={80}
            height={80}
            className="mx-auto mb-6 rounded-2xl shadow-lg ring-1 ring-white/50 dark:ring-gray-800"
          />
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-50 sm:text-5xl">
            GemiHub
          </h1>
          <p className="mx-auto mb-3 max-w-2xl text-xl font-bold text-purple-700 dark:text-purple-400 sm:text-2xl">
            {s.tagline}
          </p>
          <p className="mx-auto mb-0 max-w-2xl text-sm leading-relaxed text-gray-500 dark:text-gray-400 sm:text-base">
            {s.description}
          </p>
        </div>
      </section>

      {/* Agentic AI */}
      <section className="mx-auto max-w-5xl px-4 pb-20 pt-4">
        <div className="grid gap-6 sm:grid-cols-2">
          {s.agenticPoints.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="rounded-xl border border-purple-200 bg-purple-50 p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-purple-200/50 dark:border-purple-900 dark:bg-purple-950/40 dark:hover:shadow-purple-900/30"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/60">
                <Icon size={22} className="text-purple-600 dark:text-purple-400" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                {title}
              </h3>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {description}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col items-center gap-4">
          <a
            href="/auth/google"
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-3.5 text-lg font-semibold text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-lg"
          >
            <LogIn size={22} />
            {s.signIn}
          </a>
          <a
            href={`/manual${jaPrefix}`}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-6 py-2.5 text-base font-semibold text-gray-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-gray-50 hover:shadow-md dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <BookOpen size={18} />
            {s.heroManual}
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="bg-gray-50/30 px-4 py-20 dark:bg-gray-900/20">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {s.features.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="rounded-xl border border-gray-200 bg-white p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/40">
                  <Icon size={22} className="text-blue-600 dark:text-blue-400" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Screenshots */}
      <section className="mx-auto max-w-5xl px-4 py-20">
        <h2 className="mb-10 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
          {s.screenshotsTitle}
        </h2>
        {/* Hero screenshot */}
        {s.screenshots.length > 0 && (
          <figure className="mb-6 overflow-hidden rounded-2xl border border-gray-200 shadow-xl dark:border-gray-800">
            <img
              src={s.screenshots[0].src}
              alt={s.screenshots[0].alt}
              className="w-full"
              loading="lazy"
            />
            <figcaption className="bg-gray-50 px-5 py-4 dark:bg-gray-900">
              <p className="text-center text-sm font-semibold text-gray-900 dark:text-gray-100">{s.screenshots[0].alt}</p>
              <p className="mt-1 text-center text-sm leading-relaxed text-gray-600 dark:text-gray-400">{s.screenshots[0].description}</p>
            </figcaption>
          </figure>
        )}
        {/* Rest in grid */}
        <div className="grid gap-6 sm:grid-cols-2">
          {s.screenshots.slice(1).map(({ src, alt, description }) => (
            <figure key={src} className="overflow-hidden rounded-2xl border border-gray-200 shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl dark:border-gray-800">
              <img
                src={src}
                alt={alt}
                className="w-full"
                loading="lazy"
              />
              <figcaption className="bg-gray-50 px-4 py-3 dark:bg-gray-900">
                <p className="text-center text-sm font-semibold text-gray-900 dark:text-gray-100">{alt}</p>
                <p className="mt-1 text-center text-sm leading-relaxed text-gray-600 dark:text-gray-400">{description}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* Tech Stack */}
      <section className="bg-gray-50/30 px-4 py-20 dark:bg-gray-900/20">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-8 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
            {s.techStackTitle}
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { icon: Bot, label: "AI", text: s.techStackAi },
              { icon: Cloud, label: "Compute", text: s.techStackCompute },
              { icon: HardDrive, label: "Storage", text: s.techStackStorage },
            ].map(({ icon: Icon, label, text }) => (
              <div key={label} className="rounded-xl border border-blue-200 bg-white p-5 dark:border-blue-900 dark:bg-blue-950/40">
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/60">
                  <Icon size={22} className="text-blue-600 dark:text-blue-400" />
                </div>
                <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Google AI Pro */}
      <section className="mx-auto max-w-4xl px-4 py-20">
        <h2 className="mb-4 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
          {s.aiProTitle}
        </h2>
        <p className="mx-auto mb-10 max-w-2xl text-center text-sm text-gray-500 dark:text-gray-400 sm:text-base">
          {s.aiProIntro}
        </p>

        {/* Pricing */}
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {s.aiProPricing}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/40">
            <h4 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
              {s.aiProRegionUs}
            </h4>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">
              $19.99<span className="text-sm font-normal text-gray-500 dark:text-gray-400">{s.aiProMonthly}</span>
            </p>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              $179.88{s.aiProAnnual} <span className="text-gray-400 dark:text-gray-500">($14.99{s.aiProMonthly})</span>
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/40">
            <h4 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
              {s.aiProRegionJp}
            </h4>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">
              ¥2,900<span className="text-sm font-normal text-gray-500 dark:text-gray-400">{s.aiProMonthly}</span>
            </p>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              ¥28,800{s.aiProAnnual} <span className="text-gray-400 dark:text-gray-500">(¥2,400{s.aiProMonthly})</span>
            </p>
          </div>
        </div>

        {/* What's Included */}
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/40">
            <Sparkles size={24} className="mb-2 text-amber-600 dark:text-amber-400" />
            <h4 className="mb-1.5 text-base font-semibold text-gray-900 dark:text-gray-100">
              {s.aiProAiFeatures}
            </h4>
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              {s.aiProAiFeaturesDesc}
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/40">
            <HardDrive size={24} className="mb-2 text-amber-600 dark:text-amber-400" />
            <h4 className="mb-1.5 text-base font-semibold text-gray-900 dark:text-gray-100">
              {s.aiProStorage}
            </h4>
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              {s.aiProStorageDesc}
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/40">
            <Code size={24} className="mb-2 text-amber-600 dark:text-amber-400" />
            <h4 className="mb-1.5 text-base font-semibold text-gray-900 dark:text-gray-100">
              {s.aiProDevBenefits}
            </h4>
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              {s.aiProDevBenefitsDesc}
            </p>
          </div>
        </div>

        {/* Cost Analysis */}
        <div className="mt-8 rounded-xl border border-amber-300 bg-amber-100 p-6 dark:border-amber-700 dark:bg-amber-900/40">
          <h3 className="mb-2 text-lg font-bold text-gray-900 dark:text-gray-100">
            {s.aiProWorthIt}
          </h3>
          <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            {s.aiProWorthItDesc}
          </p>
        </div>

        {/* Activation Steps */}
        <div className="mt-8 rounded-xl border border-amber-400 bg-amber-50 p-6 dark:border-amber-600 dark:bg-amber-950/40">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={20} className="text-amber-600 dark:text-amber-400" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {s.aiProActivateTitle}
            </h3>
          </div>
          <ol className="list-inside list-decimal space-y-1.5 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            {s.aiProActivateSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>

        {/* API Usage */}
        <h3 className="mb-4 mt-8 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {s.aiProApiUsageTitle}
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { title: s.aiProFlashTitle, sub: s.aiProFlashSub, desc: s.aiProFlashDesc },
            { title: s.aiProProTitle, sub: s.aiProProSub, desc: s.aiProProDesc },
            { title: s.aiProRagTitle, sub: s.aiProRagSub, desc: s.aiProRagDesc },
          ].map(({ title, sub, desc }) => (
            <div key={title} className="rounded-xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-900">
              <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {title}
              </h4>
              <p className="mb-2 text-xs text-gray-400 dark:text-gray-500">
                {sub}
              </p>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                {desc}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          {s.aiProApiUsageSummary}
        </p>

        {/* References */}
        <h3 className="mb-3 mt-8 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {s.aiProReferences}
        </h3>
        <ul className="space-y-1.5">
          {[
            { label: "Google AI Pro", href: "https://one.google.com/about/ai-premium" },
            { label: "Gemini API Pricing", href: "https://ai.google.dev/pricing" },
            { label: "Google One Cloud Credits", href: "https://cloud.google.com/billing/docs/how-to/google-one-credits" },
          ].map(({ label, href }) => (
            <li key={href}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
              >
                <ExternalLink size={14} />
                {label}
              </a>
            </li>
          ))}
        </ul>
      </section>

      {/* Plugin Showcase */}
      <section className="bg-gray-50/30 px-4 py-20 dark:bg-gray-900/20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-8 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
            {s.pluginShowcaseTitle}
          </h2>
          <div className="overflow-hidden rounded-2xl border border-gray-200 shadow-lg dark:border-gray-800 sm:flex">
            <div className="shrink-0 sm:w-64">
              <img
                src="/images/ronginus.png"
                alt="Ronginus"
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="flex flex-1 items-center gap-4 bg-white p-6 dark:bg-gray-900">
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
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                    takeshy/hub-ronginus
                  </code>
                </p>
                <a
                  href="https://github.com/takeshy/hub-ronginus"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-purple-600 transition-colors hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
                >
                  <Github size={16} />
                  {s.pluginShowcaseLink}
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Data Usage */}
      <section className="mx-auto max-w-4xl px-4 py-20">
        <h2 className="mb-4 text-center text-2xl font-bold text-gray-900 dark:text-gray-50 sm:text-3xl">
          {s.dataUsageTitle}
        </h2>
        <p className="mb-8 text-center text-sm text-gray-600 dark:text-gray-400">
          {s.dataUsageIntro}
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          {s.dataCards.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/40">
                <Icon size={22} className="text-green-600 dark:text-green-400" />
              </div>
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
      <section className="border-t border-gray-100 bg-white px-4 py-20 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex flex-col items-center">
          <h2 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-50">
            {s.ctaReady}
          </h2>
          <a
            href="/auth/google"
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-3.5 text-lg font-semibold text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-lg"
          >
            <LogIn size={22} />
            {s.signIn}
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-gray-50 px-4 py-8 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <a href={`/terms${jaPrefix}`} className="transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              {s.footerTerms}
            </a>
            <a href={`/policy${jaPrefix}`} className="transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              {s.footerPolicy}
            </a>
            <a href="https://github.com/takeshy/gemihub" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              <Github size={14} />
              GitHub
            </a>
            <a href={`https://github.com/takeshy/gemihub/blob/main/${lang === "ja" ? "README_ja.md" : "README.md"}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              <BookOpen size={14} />
              README
            </a>
            <a href={`/manual${jaPrefix}`} className="inline-flex items-center gap-1 transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              <BookOpen size={14} />
              {s.footerManual}
            </a>
            <a href="mailto:takeshy.work@gmail.com" className="transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">
              {s.footerContact}
            </a>
          </div>
          <p>&copy; {new Date().getFullYear()} <a href="https://takeshy.work" className="transition-colors hover:text-gray-700 hover:underline dark:hover:text-gray-200">takeshy.work</a></p>
        </div>
      </footer>
    </div>
  );
}
