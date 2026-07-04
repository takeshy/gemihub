import type { Language } from "~/types/settings";
import { prose } from "../prose";

export function MemoChapter({ lang }: { lang: Language }) {
  if (lang === "ja") return <MemoJa />;
  return <MemoEn />;
}

function MemoEn() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">Document Memos</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/memo.png" alt="Document memo panel with quote-anchored highlight" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          Every document gets its own memo timeline. Read a PDF, EPUB, Markdown, text, or image file — in the main viewer or in a dashboard <strong>File widget</strong> — and attach notes right where you read them.
        </p>

        <h2>Adding a Memo</h2>
        <ol>
          <li>Select a passage in the document.</li>
          <li>Right-click and choose <strong>Add to memo</strong>.</li>
          <li>The memo panel opens with the quote attached — write your note and post it.</li>
        </ol>
        <p>
          The selected quote is captured together with its surrounding context and painted as a highlight in the document. You can also open the memo panel any time with the <strong>Memos</strong> button in the viewer toolbar and post notes without a quote.
        </p>

        <h2>Highlights That Jump Both Ways</h2>
        <p>
          Click a highlight in the document to jump to its memo; click the quote inside a memo to jump back to the exact passage, with a brief flash so you can spot it. Anchors are quote-first, so highlights survive document edits and EPUB reflow.
        </p>

        <h2>The Memo Timeline</h2>
        <ul>
          <li><strong>Composer</strong> — write in WYSIWYG or raw Markdown; wiki links and embeds resolve and open in the IDE.</li>
          <li><strong>Pin / Edit / Delete</strong> — manage entries after posting; pinned notes stay at the top.</li>
          <li><strong>Collapse</strong> — the panel folds into a narrow rail so highlights stay visible while you read.</li>
        </ul>

        <h2>Memo List Widget</h2>
        <p>
          Add a <strong>Memo List</strong> widget to a dashboard to browse every annotated document: memo counts, a preview of the newest note (a final &quot;done reading&quot; is instantly visible), filtering and paging, and one click to reopen the source document.
        </p>

        <h2>Storage</h2>
        <p>
          Memos are ordinary Markdown files under <code>Dashboards/Memos/</code> in your Drive — portable, searchable, and syncable. Because they are plain files, AI chat and RAG can use them like any other document.
        </p>
      </div>
    </>
  );
}

function MemoJa() {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-50">ドキュメントメモ</h1>
      <figure className="mb-8 overflow-hidden rounded-xl border border-gray-200 shadow dark:border-gray-800">
        <img src="/images/memo.png" alt="引用アンカー付きハイライトとドキュメントメモパネル" className="w-full" loading="lazy" />
      </figure>
      <div className={prose}>
        <p>
          すべてのドキュメントに専用のメモタイムラインが付きます。PDF・EPUB・Markdown・テキスト・画像を、メインビューアでもダッシュボードの<strong>Fileウィジェット</strong>でも開いて、読みながらその場にノートを残せます。
        </p>

        <h2>メモの追加</h2>
        <ol>
          <li>ドキュメント内の文章を選択します。</li>
          <li>右クリックして<strong>メモに追加</strong>を選びます。</li>
          <li>引用付きでメモパネルが開くので、ノートを書いて投稿します。</li>
        </ol>
        <p>
          選択した引用は前後の文脈とともに記録され、ドキュメント上にハイライト表示されます。ビューアツールバーの<strong>メモ</strong>ボタンからいつでもメモパネルを開いて、引用なしのノートを投稿することもできます。
        </p>

        <h2>双方向ジャンプするハイライト</h2>
        <p>
          ドキュメント上のハイライトをクリックするとメモへ、メモ内の引用をクリックすると本文の該当箇所へジャンプします（フラッシュ表示で位置がすぐ分かります）。アンカーは引用文字列が主体なので、ドキュメントの編集やEPUBのリフローでもハイライトは失われません。
        </p>

        <h2>メモタイムライン</h2>
        <ul>
          <li><strong>コンポーザー</strong> — WYSIWYG / 生Markdownで記述。wikiリンクや埋め込みも解決され、IDEで開けます。</li>
          <li><strong>ピン留め / 編集 / 削除</strong> — 投稿後のエントリを管理できます。ピン留めしたノートは上部に固定されます。</li>
          <li><strong>折り畳み</strong> — パネルは細いレールに折り畳めるので、ハイライトを表示したまま読書に集中できます。</li>
        </ul>

        <h2>Memo Listウィジェット</h2>
        <p>
          ダッシュボードに<strong>Memo List</strong>ウィジェットを追加すると、メモを付けた全ドキュメントを一覧できます。メモ件数、最新ノートのプレビュー（「読了」などの最後のひとことが一目で分かる）、絞り込み・ページング、ワンクリックで元ドキュメントを開けます。
        </p>

        <h2>保存場所</h2>
        <p>
          メモはDriveの<code>Dashboards/Memos/</code>配下の普通のMarkdownファイルです。ポータブルで、検索も同期も自由自在。ただのファイルなので、AIチャットやRAGからも他のドキュメントと同様に利用できます。
        </p>
      </div>
    </>
  );
}
