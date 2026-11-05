import { tr } from "../shared/i18n";
import { useShopDisplay } from "./money";
import { articleKinds } from "../shared/article-features";
import { createRequestId } from "./request-id";
import { ArticleImageChooser } from "./ArticleImages";
import { ArticleTextEditor } from "./ArticleTextEditor";
import type { ArticleFile } from "../server/article-files";
import { DateInput } from "./DateInput";
import { createPortal } from "react-dom";
import { submitOnShortcut } from "./submit-shortcut";
import "./BlogEditor.css";
import React, { useEffect, useState, useRef, lazy, Suspense } from "react";
import { useApi } from "./api";
import { PostContent } from "./PostContent";
import {
  postLabel,
  postPath,
  postContentSchema,
  type Post,
  type PostContent as Content,
  type PostCategory,
  type PublicPost,
  type PostSummary,
} from "../server/post-domain";
import type { Workspace } from "./App";

const ArticleEditor = lazy(() => import("./ArticleEditor"));
export type Navigate = (href: string) => void;
type Run = (fn: () => Promise<void>) => Promise<void>;
const freshContent = (date: string, category: PostCategory = "blogs"): Content => ({
  category,
  title: "",
  slug: "",
  date,
  excerpt: "",
  body: "",
});
export function BlogEditor({
  shop,
  run,
  busy,
  notify,
  reload,
}: {
  shop: Workspace;
  run: Run;
  busy: boolean;
  notify: (message: string) => void;
  reload: () => Promise<unknown>;
  demo: boolean;
}) {
  const api = useApi();
  const { shopToday } = useShopDisplay();
  const fresh = () => freshContent(shopToday(), articleKinds(shop.published)[0] || "blogs");
  const [posts, setPosts] = useState<Post[]>([]),
    [current, setCurrent] = useState<Post>();
  const [content, setContent] = useState<Content>(fresh),
    [step, setStep] = useState<"edit" | "draft">("edit"),
    [aiOpen, setAiOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"text" | "visual">("text");
  const [instruction, setInstruction] = useState(""),
    [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);
  const [saveId, setSaveId] = useState(createRequestId),
    [turnId, setTurnId] = useState(createRequestId);
  const [mediaBusy, setMediaBusy] = useState(false),
    [imageOpen, setImageOpen] = useState(false),
    [files, setFiles] = useState<ArticleFile[]>([]),
    [fileError, setFileError] = useState("");
  const requestInput = useRef<HTMLTextAreaElement>(null);
  const aiLog = useRef<HTMLDivElement>(null);
  const aiTrigger = useRef<HTMLButtonElement>(null);
  const confirmPanel = useRef<HTMLElement>(null);
  const confirmBody = useRef<HTMLDivElement>(null);
  const base = `/api/shops/${shop.id}/posts`;
  const clean =
    !!current && JSON.stringify(content) === JSON.stringify(current.draft);
  const blocked = busy || mediaBusy || !shop.isOwner;
  async function load() {
    const values = await api<Post[]>(base);
    setPosts(values);
    return values;
  }
  useEffect(() => {
    void run(async () => {
      await load();
    });
  }, [shop.id]);
  useEffect(() => {
    if (!aiOpen) return;
    let active = true;
    setFileError("");
    api<ArticleFile[]>(`${base}/files`)
      .then((result) => {
        if (active) setFiles(result);
      })
      .catch((error) => {
        if (active) setFileError(error.message);
      });
    return () => {
      active = false;
    };
  }, [base, aiOpen]);
  useEffect(() => {
    if (step !== "draft") return;
    confirmPanel.current?.scrollIntoView({ block: "start" });
  }, [step]);
  useEffect(() => {
    if (!aiOpen) return;
    document.body.classList.add("article-ai-open");
    confirmBody.current?.scrollIntoView({ block: "start" });
    requestInput.current?.focus({ preventScroll: true });
    return () => { document.body.classList.remove("article-ai-open"); };
  }, [aiOpen]);
  useEffect(() => {
    if (aiLog.current) aiLog.current.scrollTop = aiLog.current.scrollHeight;
  }, [aiOpen, messages, busy]);
  function closeAi() {
    setAiOpen(false);
    aiTrigger.current?.focus({ preventScroll: true });
  }
  function backToEdit() {
    setAiOpen(false);
    setStep("edit");
  }
  function choose(post?: Post) {
    setCurrent(post);
    setContent(post ? structuredClone(post.draft) : fresh());
    setStep("edit");
    setAiOpen(false);
    setEditorMode("text");
    setSaveId(createRequestId());
    setTurnId(createRequestId());
    setInstruction("");
    setConversationId(undefined);
    setMessages([]);
  }
  const update = <K extends keyof Content>(key: K, value: Content[K]) => {
    setContent((current) => ({ ...current, [key]: value }));
    setSaveId(createRequestId());
  };
  async function accept(post: Post, refresh = true) {
    setCurrent(post);
    setContent(structuredClone(post.draft));
    setSaveId(createRequestId());
    setPosts(values => values.some(value => value.id === post.id) ? values.map(value => value.id === post.id ? post : value) : [post, ...values]);
    if (refresh) { await load(); await reload(); }
  }
  function insertReference(path: string) {
    const input = requestInput.current;
    const start = input?.selectionStart ?? instruction.length,
      end = input?.selectionEnd ?? start;
    const text = `[[${path}]]`;
    setInstruction(instruction.slice(0, start) + text + instruction.slice(end));
    setTurnId(createRequestId());
    requestAnimationFrame(() => {
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(start + text.length, start + text.length);
      if (input?.form) input.form.scrollTop = 0;
    });
  }
  const ready =
    !!content.title.trim() &&
    !!content.body.trim() &&
    !!content.date;
  async function storeDraft(next: Content, requestId: string) {
    const fields = postContentSchema
      .omit({ slug: true, excerpt: true })
      .parse(next);
    try {
      const saved = await api<Post>(current ? `${base}/${current.id}/draft` : `${base}/drafts`, {
        content: fields,
        requestId,
        ...(current ? { version: current.version } : {}),
      });
      await accept(saved, false);
      return saved;
    } catch (error) {
      await load().catch(() => {});
      throw error;
    }
  }
  function saveDraft() {
    void run(async () => {
      await storeDraft(content, saveId);
      setStep("draft");
      notify(tr("下書きを保存しました。お客様にはまだ表示されません。"));
    });
  }
  function publish() {
    if (!current) return;
    void run(async () => {
      try {
        await accept(
          await api<Post>(`${base}/${current.id}/publish`, {
            version: current.version,
            approved: true,
          }),
        );
      } catch (error) {
        await load().catch(() => {});
        throw error;
      }
      backToEdit();
      notify(tr("下書きを公開しました。"));
    });
  }
  const aiPanel = aiOpen && createPortal(
    <section
      className="visual-chat-panel article-ai-chat"
      aria-label={tr("AIで記事を修正")}
      onKeyDown={event => { if (event.key === "Escape" && !blocked && !imageOpen) { event.preventDefault(); closeAi(); } }}
    >
      <div className="visual-chat-heading"><h3>{tr("AIで記事を修正")}</h3><button type="button" disabled={blocked} aria-label={tr("閉じる")} onClick={closeAi}>×</button></div>
      <p className="small muted">{tr("指示した内容で下書きを修正して保存します。「公開する」を押すまで公開されません。")}</p>
      <div className="chat-log visual-chat-log" ref={aiLog} role="log" aria-label={tr("記事の依頼")} aria-live="polite">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`article-chat-message ${message.role}`}
          >
            <b>{message.role === "user" ? tr("あなた") : "AI"}</b>
            <p>{message.text}</p>
          </div>
        ))}
      </div>
      {fileError && (
        <p className="alert" role="alert">
          {fileError}
        </p>
      )}
      <form className="article-ai-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!instruction.trim() || blocked) return;
          void run(async () => {
            const result = await api<{
              title: string;
              excerpt: string;
              body: string;
              conversationId?: string;
            }>(`${base}/propose`, {
              instruction,
              source: content.body,
              title: content.title,
              requestId: turnId,
              conversationId,
            });
            setConversationId(result.conversationId);
            await storeDraft(
              { ...content, title: result.title, body: result.body, excerpt: result.excerpt },
              createRequestId(),
            );
            setMessages((value) => [
              ...value,
              { role: "user", text: instruction },
              {
                role: "assistant",
                text: tr("下書きを修正して保存しました。内容を確かめてください。追加の依頼もできます。"),
              },
            ]);
            setInstruction("");
            setTurnId(createRequestId());
            notify(tr("AIが下書きを修正して保存しました。まだ公開されていません。"));
          });
        }}
      >
        <label>
          {tr("AIに伝える内容")}<textarea
            ref={requestInput}
            aria-label={tr("AIに伝える内容")}
            rows={3}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            onKeyDown={event => submitOnShortcut(event)}
            maxLength={10000}
            value={instruction}
            disabled={blocked}
            onChange={(event) => {
              setInstruction(event.target.value);
              setTurnId(createRequestId());
            }}
          placeholder={tr("例：書いた文章を読みやすく清書してください。写真や[[spec.md]]も参考にしてください。")}
          />
        </label>
        <div className="article-composer-actions">
          <button
            type="button"
            disabled={blocked}
            onClick={() => setImageOpen(true)}
          >
            {tr("📎 画像を添付")}</button>
          <details className="article-ai-references">
            <summary>{tr("資料を選ぶ")}</summary><select
              aria-label={tr("記事の参照ファイル")}
              value=""
              disabled={blocked}
              onChange={(event) => {
                if (event.target.value)
                  insertReference(event.target.value);
              }}
            >
              <option value="">{tr("お店のファイルから選ぶ")}</option>
              {files.map((file) => (
                <option key={file.path} value={file.path}>
                  {file.name}
                </option>
              ))}
            </select>
            <p className="small muted">{tr("[[パス]]でお店のファイルを参照できます。画像を添付すると、参照するパスが入力されます。")}</p>
          </details>
          <button
            className="primary article-ai-send"
            disabled={blocked || !instruction.trim()}
          >
            {busy ? tr("AIが記事を修正しています…") : tr("送信する")}
          </button>
        </div>
      </form>
      <ArticleImageChooser
        shopId={shop.id}
        open={imageOpen}
        close={() => setImageOpen(false)}
        select={(image) => insertReference(image.path)}
        onBusy={setMediaBusy}
      />
    </section>, document.body
  );
  if (step === "draft")
    return (
      <div className="blog-editor-layout article-confirm-layout">
        <section className="panel post-confirm" ref={confirmPanel} aria-label={tr("記事の下書き")}>
          <span className="eyebrow">BLOG & NEWS</span>
          <div className="section-top">
            <h2>{tr("記事の下書き")}</h2>
            <span className="pill">{current?.published ? tr("公開中の記事の下書き") : tr("下書き・非公開")}</span>
          </div>
          <p className="notice">
            {tr("この下書きにはAIで修正を指示できます。「公開する」を押すまでお客様には表示されません。")}</p>
          <div className="post-confirm-body" ref={confirmBody}>
            <PostContent
              post={{ ...content, excerpt: clean ? content.excerpt : "" }}
              imageBase={`/api/shops/${shop.id}/images`}
            />
          </div>
          <div className="actions">
            <button type="button" disabled={blocked} onClick={backToEdit}>
              {tr("編集に戻る")}
            </button>
            <button type="button" ref={aiTrigger} disabled={blocked} aria-expanded={aiOpen} onClick={() => setAiOpen(true)}>
              {tr("AIで修正")}
            </button>
            <button className="primary" disabled={blocked || !shop.published || !current || !clean} onClick={publish}>
              {tr("公開する")}</button>
          </div>
        </section>
        {aiPanel}
      </div>
    );
  return (
    <div className="blog-editor-layout">
      <div className="panel post-management-list">
        <div className="section-top">
          <h2>{tr("お店のお便り")}</h2>
        </div>
        <p className="small muted">
          {tr("保存前の編集は、お客様には反映されません。")}</p>
        {!posts.length && (
          <p className="empty">{tr("最初のお便りを書いてみましょう。")}</p>
        )}
        {posts.map((post) => (
          <button
            key={post.id}
            className={`post-management-item ${post.id === current?.id ? "selected" : ""}`}
            onClick={() => choose(post)}
            disabled={blocked}
          >
            <span className="post-meta">
              <span className="pill">{postLabel(post.draft.category)}</span>
              <small>{post.published ? tr("公開中") : tr("下書き・非公開")}</small>
            </span>
            <strong>{post.draft.title}</strong>
            <small>{post.draft.date.replaceAll("-", "/")}</small>
          </button>
        ))}
      </div>
      <div className="post-editor-workspace">
        <section className="panel post-editor">
          <span className="eyebrow">BLOG & NEWS</span>
          <div className="section-top">
            <h2>{current ? tr("記事を編集する") : tr("新しいお便りを書く")}</h2>
            {current && <button type="button" disabled={blocked} onClick={() => choose()}>{tr("新しいお便りを書く")}</button>}
          </div>
          {!shop.isOwner && (
            <p className="notice">{tr("記事の作成・変更・公開は店主が行います。")}</p>
          )}
          <div className="article-writing-help">
            <p className="small muted">{tr("まずは自分の言葉で書いてみましょう。下書き保存すると、下書きに対してAIで修正を指示できます。")}</p>
          </div>
          <fieldset disabled={blocked}>
            <div className="form-grid article-metadata">
              <label className="field">
                <span>{tr("記事の種類")}</span>
                <select
                  value={content.category}
                  disabled={!!current?.address}
                  onChange={(event) =>
                    update("category", event.target.value as PostCategory)
                  }
                >
                  {(["blogs", "announcements"] as const).filter(kind=>articleKinds(shop.published).includes(kind)||current?.draft.category===kind).map(kind=><option key={kind} value={kind}>{postLabel(kind)}</option>)}
                </select>
              </label>
              <label className="field">
                <span>{tr("記事の日付（表示用）")}</span>
                <DateInput
                  aria-label={tr("記事の日付（表示用）")}
                  value={content.date}
                  disabled={!!current?.address}
                  onValueChange={(value) => update("date", value)}
                />
              </label>
            </div>
          </fieldset>
          <label className="field">
            <span>{tr("タイトル")}</span>
            <input
              maxLength={160}
              value={content.title}
              disabled={blocked}
              onChange={(event) => update("title", event.target.value)}
              placeholder={tr("秋の新しいデザインができました")}
            />
          </label>
          <div className="article-editor-modes" role="group" aria-label={tr("本文の入力方法")}>
            <button type="button" disabled={blocked} aria-pressed={editorMode === "text"} onClick={() => setEditorMode("text")}>
              {tr("テキスト")}
            </button>
            <button type="button" disabled={blocked} aria-pressed={editorMode === "visual"} onClick={() => setEditorMode("visual")}>
              {tr("リッチテキスト")}
            </button>
          </div>
          {editorMode === "text" ? (
            <ArticleTextEditor
              shopId={shop.id}
              value={content.body}
              onChange={(value) => update("body", value)}
              disabled={blocked}
              onBusy={setMediaBusy}
            />
          ) : (
            <Suspense
              fallback={
                <p role="status">{tr("記事の編集画面を読み込んでいます…")}</p>
              }
            >
              <ArticleEditor
                key={current?.id || "new"}
                shopId={shop.id}
                value={content.body}
                onChange={(value) => update("body", value)}
                disabled={blocked}
                onBusy={setMediaBusy}
              />
            </Suspense>
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={blocked || !ready}
              onClick={saveDraft}
            >
              {tr("下書き保存")}</button>
          </div>
          {!clean && current && (
            <p className="small muted">
              {tr("未保存の変更があります。下書き保存すると、AIでの修正と公開ができます。")}</p>
          )}
          {current?.published && (
            <div className="post-published-note">
              <b>{tr("公開中のページ")}</b>
              <a
                data-article-link
                href={postPath(shop.publicUrl, current.published)}
                target="_blank"
                rel="noreferrer"
              >
                {current.published.title} ↗
              </a>
              <button
                disabled={blocked}
                onClick={() =>
                  void run(async () => {
                    await accept(
                      await api<Post>(`${base}/${current.id}/unpublish`, {
                        version: current.version,
                      }),
                    );
                    notify(
                      tr("記事を非公開にしました。下書きと履歴は残っています。"),
                    );
                  })
                }
              >
                {tr("非公開にする")}</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function RecentPosts({
  posts,
  basePath,
  navigate,
  archive = "blogs",
}: {
  posts: PostSummary[];
  basePath: string;
  navigate: Navigate;
  archive?: PostCategory;
}) {
  if (!posts.length) return null;
  return (
    <section className="panel recent-posts">
      <div className="section-top">
        <h2>{tr("お店からのお便り")}</h2>
        <a
          data-article-link
          href={`${basePath}/${archive}`}
          onClick={(e) => {
            e.preventDefault();
            navigate(`${basePath}/${archive}`);
          }}
        >
          {archive === "blogs" ? tr("ブログ一覧 →") : tr("お知らせ一覧 →")}</a>
      </div>
      <div className="recent-post-list">
        {posts.map((post) => (
          <a
            key={post.id}
            data-article-link
            href={postPath(basePath, post)}
            onClick={(e) => {
              e.preventDefault();
              navigate(postPath(basePath, post));
            }}
          >
            <span className="post-meta">
              <time>{post.date}</time>
              <span className="pill">{postLabel(post.category)}</span>
            </span>
            <strong>{post.title}</strong>
          </a>
        ))}
      </div>
    </section>
  );
}
export function PublicBlog({
  baseApi,
  basePath,
  category,
  articleKey,
  navigate,
}: {
  baseApi: string;
  basePath: string;
  category: PostCategory;
  articleKey?: string;
  navigate: Navigate;
}) {
  const api = useApi();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{
    items: PostSummary[];
    total: number;
    page: number;
    size: number;
  }>();
  const [post, setPost] = useState<PublicPost>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    setResult(undefined);
    setPost(undefined);
    const request =
      articleKey && articleKey !== "index"
        ? api<PublicPost>(`${baseApi}/posts/${category}/${articleKey}`).then(
            (p) => {
              if (active) setPost(p);
            },
          )
        : api<{
            items: PostSummary[];
            total: number;
            page: number;
            size: number;
          }>(`${baseApi}/posts?category=${category}&page=${page}`).then((p) => {
            if (active) setResult(p);
          });
    request.catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [baseApi, category, articleKey, page]);
  if (error)
    return (
      <div className="panel">
        <h2>{tr("記事を表示できません")}</h2>
        <p role="alert">{error}</p>
        <a
          data-article-link
          href={`${basePath}/${category}`}
          onClick={(e) => {
            e.preventDefault();
            navigate(`${basePath}/${category}`);
          }}
        >
          {tr("一覧に戻る")}</a>
      </div>
    );
  if (post)
    return (
      <div className="panel article-page">
        <a
          data-article-link
          href={`${basePath}/${category}`}
          onClick={(e) => {
            e.preventDefault();
            navigate(`${basePath}/${category}`);
          }}
        >
          ← {postLabel(category)}{tr("の一覧")}</a>
        <PostContent post={post} imageBase={`${baseApi}/images`} />
        <div className="actions">
          <a
            className="button primary"
            data-article-link
            href={basePath || "/"}
            onClick={(e) => {
              e.preventDefault();
              navigate(basePath || "/");
            }}
          >
            {tr("お店の予約ページへ →")}</a>
        </div>
      </div>
    );
  return (
    <section className="panel post-archive">
      <span className="eyebrow">
        {category === "blogs" ? "SHOP JOURNAL" : "NEWS"}
      </span>
      <h2>{postLabel(category)}</h2>
      <p className="muted">
        {category === "blogs"
          ? tr("お店の日々や、季節のおすすめをお届けします。")
          : tr("お店からの大切なご案内です。")}
      </p>
      {!result ? (
        <p>{tr("記事を読み込んでいます…")}</p>
      ) : (
        <>
          {!result.items.length && (
            <p className="empty">{tr("記事はまだありません。")}</p>
          )}
          <div className="post-archive-grid">
            {result.items.map((p) => (
              <a
                key={p.id}
                data-article-link
                className="post-archive-card"
                href={postPath(basePath, p)}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(postPath(basePath, p));
                }}
              >
                <span className="post-meta">
                  <time>{p.date}</time>
                  <span className="pill">{postLabel(p.category)}</span>
                </span>
                <h3>{p.title}</h3>
                <span className="small">{tr("続きを読む →")}</span>
              </a>
            ))}
          </div>
          {result.total > result.size && (
            <div className="actions">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {tr("前のページ")}</button>
              <span>
                {page} / {Math.ceil(result.total / result.size)}
              </span>
              <button
                disabled={page * result.size >= result.total}
                onClick={() => setPage((p) => p + 1)}
              >
                {tr("次のページ")}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
