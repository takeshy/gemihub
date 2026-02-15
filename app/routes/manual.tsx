import { useLocation, useParams, Navigate } from "react-router";
import type { Language } from "~/types/settings";
import { ManualLayout, type ChapterInfo } from "~/components/manual/ManualLayout";
import { ManualIndex } from "~/components/manual/ManualIndex";
import { IntroChapter } from "~/components/manual/chapters/intro";
import { LayoutChapter } from "~/components/manual/chapters/layout";
import { SetupChapter } from "~/components/manual/chapters/setup";
import { ChatChapter } from "~/components/manual/chapters/chat";
import { EditorChapter } from "~/components/manual/chapters/editor";
import { SyncChapter } from "~/components/manual/chapters/sync";
import { WorkflowChapter } from "~/components/manual/chapters/workflow";
import { SearchChapter } from "~/components/manual/chapters/search";
import { RagChapter } from "~/components/manual/chapters/rag";
import { McpChapter } from "~/components/manual/chapters/mcp";
import { EncryptionChapter } from "~/components/manual/chapters/encryption";
import { PluginsChapter } from "~/components/manual/chapters/plugins";
import { SettingsOverviewChapter } from "~/components/manual/chapters/settings-overview";
import { ShortcutsChapter } from "~/components/manual/chapters/shortcuts";
import { FaqChapter } from "~/components/manual/chapters/faq";

export function headers() {
  return {
    "Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400, max-age=3600",
  };
}

interface ChapterDef extends ChapterInfo {
  component: React.ComponentType<{ lang: Language }>;
}

const CHAPTERS: ChapterDef[] = [
  { slug: "intro", num: 1, titleEn: "What is GemiHub?", titleJa: "GemiHubとは", descEn: "Overview, key features, and how GemiHub works.", descJa: "概要、主な機能、GemiHubの仕組み。", component: IntroChapter },
  { slug: "layout", num: 2, titleEn: "Screen Layout", titleJa: "画面構成", descEn: "Understanding the IDE layout: sidebar, editor, and panels.", descJa: "IDE画面の構成：サイドバー、エディタ、パネル。", component: LayoutChapter },
  { slug: "setup", num: 3, titleEn: "Initial Setup", titleJa: "初期セットアップ", descEn: "Sign in, API key configuration, and first sync.", descJa: "サインイン、APIキー設定、初回同期。", component: SetupChapter },
  { slug: "chat", num: 4, titleEn: "AI Chat", titleJa: "AIチャット", descEn: "Chat with Gemini AI: streaming, tools, file attachments, and slash commands.", descJa: "Gemini AIとのチャット：ストリーミング、ツール、ファイル添付、スラッシュコマンド。", component: ChatChapter },
  { slug: "editor", num: 5, titleEn: "File Editor", titleJa: "ファイル編集", descEn: "Markdown editing, WYSIWYG, diff view, and edit history.", descJa: "Markdownエディタ、WYSIWYG、差分表示、編集履歴。", component: EditorChapter },
  { slug: "sync", num: 6, titleEn: "Sync: Push to Drive / Pull to Local", titleJa: "同期：ドライブ反映 / ローカル反映", descEn: "Offline-first caching, sync to Drive and local, and conflict resolution.", descJa: "オフラインファーストキャッシュ、ドライブ反映・ローカル反映、コンフリクト解決。", component: SyncChapter },
  { slug: "workflow", num: 7, titleEn: "Workflows", titleJa: "ワークフロー", descEn: "Visual workflow builder, AI generation, execution, and node types.", descJa: "ビジュアルワークフロービルダー、AI生成、実行、ノードタイプ。", component: WorkflowChapter },
  { slug: "search", num: 8, titleEn: "Search", titleJa: "検索", descEn: "Local, Drive, and RAG search modes plus Quick Open.", descJa: "ローカル・Drive・RAG検索モードとQuick Open。", component: SearchChapter },
  { slug: "rag", num: 9, titleEn: "RAG", titleJa: "RAG", descEn: "Retrieval-Augmented Generation: setup, sync, and semantic search.", descJa: "RAG（検索拡張生成）：設定、同期、意味検索。", component: RagChapter },
  { slug: "mcp", num: 10, titleEn: "MCP", titleJa: "MCP", descEn: "Model Context Protocol: connect external tools and services.", descJa: "MCP（モデルコンテキストプロトコル）：外部ツール・サービスとの連携。", component: McpChapter },
  { slug: "encryption", num: 11, titleEn: "Encryption", titleJa: "暗号化", descEn: "Hybrid RSA+AES encryption for files, chat, and workflow history.", descJa: "ファイル、チャット、ワークフロー履歴のハイブリッドRSA+AES暗号化。", component: EncryptionChapter },
  { slug: "plugins", num: 12, titleEn: "Plugins", titleJa: "プラグイン", descEn: "Install, manage, and develop plugins from GitHub.", descJa: "GitHubからのプラグインのインストール、管理、開発。", component: PluginsChapter },
  { slug: "settings-overview", num: 13, titleEn: "Settings Overview", titleJa: "設定一覧", descEn: "All settings tabs: General, MCP, RAG, Plugins, Commands, Shortcuts.", descJa: "全設定タブの概要：一般、MCP、RAG、プラグイン、コマンド、ショートカット。", component: SettingsOverviewChapter },
  { slug: "shortcuts", num: 14, titleEn: "Keyboard Shortcuts", titleJa: "キーボードショートカット", descEn: "Built-in shortcuts and custom workflow shortcuts.", descJa: "組み込みショートカットとカスタムワークフローショートカット。", component: ShortcutsChapter },
  { slug: "faq", num: 15, titleEn: "FAQ", titleJa: "FAQ", descEn: "Frequently asked questions and troubleshooting.", descJa: "よくある質問とトラブルシューティング。", component: FaqChapter },
];

const CHAPTER_MAP = new Map(CHAPTERS.map((ch) => [ch.slug, ch]));

export default function Manual() {
  const { pathname } = useLocation();
  const { chapter } = useParams();
  const lang: Language = pathname.startsWith("/manual/ja") ? "ja" : "en";

  const chapterInfos: ChapterInfo[] = CHAPTERS.map(({ slug, num, titleEn, titleJa, descEn, descJa }) => ({
    slug,
    num,
    titleEn,
    titleJa,
    descEn,
    descJa,
  }));

  // Index page
  if (!chapter) {
    return (
      <ManualLayout lang={lang} chapters={chapterInfos}>
        <ManualIndex lang={lang} chapters={chapterInfos} />
      </ManualLayout>
    );
  }

  // Chapter page
  const ch = CHAPTER_MAP.get(chapter);
  if (!ch) {
    const base = lang === "ja" ? "/manual/ja" : "/manual";
    return <Navigate to={base} replace />;
  }

  const Component = ch.component;
  return (
    <ManualLayout lang={lang} chapters={chapterInfos} currentSlug={chapter}>
      <Component lang={lang} />
    </ManualLayout>
  );
}
