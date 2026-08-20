import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function SearchChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <SearchJa />;
  return <SearchEn />;
}

function SearchEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">Search</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/rag_search_en.png" alt="Search panel" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          GemiHub offers three search modes and a Quick Open dialog for rapid file navigation.
        </p>

        <h2>Opening the Search Panel</h2>
        <p>
          Press <kbd>Ctrl+Shift+F</kbd> / <kbd>Cmd+Shift+F</kbd> or click the Search icon in the left sidebar. The search panel replaces the file tree when active.
        </p>

        <h2>Local Search</h2>
        <p>
          Searches files cached in your browser&apos;s IndexedDB. This works offline and searches both file names and content.
        </p>
        <ul>
          <li>Multi-term search: all terms must match (AND logic).</li>
          <li>Case-insensitive matching.</li>
          <li>Shows content snippets around matching terms.</li>
          <li>Only searches locally cached files.</li>
        </ul>

        <h2>Drive Search</h2>
        <p>
          Full-text search via Google Drive API. Searches file names and content in your <code>gemihub/</code> folder. Requires internet connection.
        </p>

        <h2>RAG Search</h2>
        <p>
          Semantic search using Gemini&apos;s File Search (RAG). Searches by meaning rather than exact keywords. Requires configured RAG stores in Settings.
        </p>
        <ul>
          <li>Uses a multiline text input (press <kbd>Ctrl+Enter</kbd> / <kbd>Cmd+Enter</kbd> to search).</li>
          <li>Returns both matching file results and an AI-generated answer.</li>
          <li>Select the model used for RAG search from the dropdown.</li>
        </ul>

        <h2>Quick Open</h2>
        <p>
          Press <kbd>Ctrl+P</kbd> / <kbd>Cmd+P</kbd> to open the Quick Open dialog. Type to filter files by name and path, then press Enter to open the selected file. Navigate with arrow keys.
        </p>
      </div>
    </>
  );
}

function SearchJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">検索</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/rag_search.png" alt="検索パネル" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          GemiHubは3つの検索モードとQuick Openダイアログを提供しています。
        </p>

        <h2>検索パネルを開く</h2>
        <p>
          <kbd>Ctrl+Shift+F</kbd> / <kbd>Cmd+Shift+F</kbd>を押すか、左サイドバーの検索アイコンをクリックします。検索パネルはアクティブ時にファイルツリーと置き換わります。
        </p>

        <h2>ローカル検索</h2>
        <p>
          ブラウザのIndexedDBにキャッシュされたファイルを検索します。オフラインで動作し、ファイル名とコンテンツの両方を検索します。
        </p>
        <ul>
          <li>複数語検索：すべての語が一致する必要あり（AND条件）。</li>
          <li>大文字小文字を区別しない。</li>
          <li>マッチした語の前後のコンテンツスニペットを表示。</li>
          <li>ローカルにキャッシュされたファイルのみ検索対象。</li>
        </ul>

        <h2>Drive検索</h2>
        <p>
          Google Drive APIによる全文検索。<code>gemihub/</code>フォルダ内のファイル名とコンテンツを検索します。インターネット接続が必要です。
        </p>

        <h2>RAG検索</h2>
        <p>
          GeminiのFile Search（RAG）による意味検索。キーワードの完全一致ではなく、意味で検索します。設定でRAGストアの構成が必要です。
        </p>
        <ul>
          <li>複数行テキスト入力を使用（<kbd>Ctrl+Enter</kbd> / <kbd>Cmd+Enter</kbd>で検索）。</li>
          <li>マッチするファイル結果とAI生成の回答の両方を返します。</li>
          <li>ドロップダウンからRAG検索に使用するモデルを選択。</li>
        </ul>

        <h2>Quick Open</h2>
        <p>
          <kbd>Ctrl+P</kbd> / <kbd>Cmd+P</kbd>でQuick Openダイアログを開きます。入力してファイル名とパスでフィルタリングし、Enterで選択したファイルを開きます。矢印キーで移動。
        </p>
      </div>
    </>
  );
}
