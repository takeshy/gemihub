import { createRequestId } from "./request-id";
import { ArticleImageChooser } from "./ArticleImages";
import type { ArticleFile } from "../server/article-files";
import { DateInput } from "./DateInput";
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
import { dateJST } from "../server/domain";
import type { Workspace } from "./App";

const ArticleEditor = lazy(() => import("./ArticleEditor"));
export type Navigate = (href: string) => void;
type Run = (fn: () => Promise<void>) => Promise<void>;
const freshContent = (): Content => ({
  category: "blogs",
  title: "",
  slug: "",
  date: dateJST(),
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
  const [posts, setPosts] = useState<Post[]>([]),
    [current, setCurrent] = useState<Post>();
  const [content, setContent] = useState<Content>(freshContent),
    [method, setMethod] = useState<"ai" | "write">();
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
    if (method !== "ai") return;
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
  }, [base, method]);
  function choose(post?: Post) {
    setCurrent(post);
    setContent(post ? structuredClone(post.draft) : freshContent());
    setMethod(post ? "write" : undefined);
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
  async function accept(post: Post) {
    setCurrent(post);
    setContent(structuredClone(post.draft));
    setSaveId(createRequestId());
    await load();
    await reload();
  }
  function insertReference(path: string) {
    const input = requestInput.current;
    const start = input?.selectionStart ?? instruction.length,
      end = input?.selectionEnd ?? start;
    const text = `[[${path}]]`;
    setInstruction(instruction.slice(0, start) + text + instruction.slice(end));
    setTurnId(createRequestId());
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + text.length, start + text.length);
    });
  }
  return (
    <div className="blog-editor-layout">
      <div className="panel post-management-list">
        <div className="section-top">
          <h2>お店のお便り</h2>
          <button disabled={blocked} onClick={() => choose()}>
            ＋ 新しい記事
          </button>
        </div>
        <p className="small muted">
          保存前の編集は、お客様には反映されません。
        </p>
        {!posts.length && (
          <p className="empty">最初のお便りを書いてみましょう。</p>
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
              <small>{post.published ? "公開中" : "下書き・非公開"}</small>
            </span>
            <strong>{post.draft.title}</strong>
            <small>{post.draft.date.replaceAll("-", "/")}</small>
          </button>
        ))}
      </div>
      <div>
        <section className="panel post-editor">
          <span className="eyebrow">BLOG & NEWS</span>
          <h2>{current ? "記事を編集する" : "新しいお便りを書く"}</h2>
          {!shop.isOwner && (
            <p className="notice">記事の作成・変更・公開は店主が行います。</p>
          )}
          <div
            className="article-methods"
            role="group"
            aria-label="記事の作成方法"
          >
            <button
              type="button"
              disabled={blocked}
              aria-pressed={method === "ai"}
              onClick={() => setMethod("ai")}
            >
              <b>AIに依頼する</b>
              <span>書きたい内容や使う画像を伝えます</span>
            </button>
            <button
              type="button"
              disabled={blocked}
              aria-pressed={method === "write"}
              onClick={() => setMethod("write")}
            >
              <b>自分で作成する</b>
              <span>見出しや写真を入れて記事を書きます</span>
            </button>
          </div>
          {method && (
            <>
              <fieldset disabled={blocked}>
                <div className="form-grid">
                  <label className="field">
                    <span>記事の種類</span>
                    <select
                      value={content.category}
                      disabled={!!current?.address}
                      onChange={(event) =>
                        update("category", event.target.value as PostCategory)
                      }
                    >
                      <option value="blogs">ブログ</option>
                      <option value="announcements">お知らせ</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>記事の日付（表示用）</span>
                    <DateInput
                      aria-label="記事の日付（表示用）"
                      value={content.date}
                      disabled={!!current?.address}
                      onValueChange={(value) => update("date", value)}
                    />
                  </label>
                </div>
              </fieldset>
              {method === "ai" ? (
                <section
                  className="article-ai-chat"
                  aria-label="AIと記事を作る"
                >
                  <div role="log" aria-label="記事の依頼">
                    {messages.map((message, index) => (
                      <div
                        key={index}
                        className={`article-chat-message ${message.role}`}
                      >
                        <b>{message.role === "user" ? "あなた" : "AI"}</b>
                        <p>{message.text}</p>
                      </div>
                    ))}
                  </div>
                  {fileError && (
                    <p className="alert" role="alert">
                      {fileError}
                    </p>
                  )}
                  <form
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
                        setContent((value) => ({
                          ...value,
                          title: result.title,
                          body: result.body,
                          excerpt: result.excerpt,
                        }));
                        setSaveId(createRequestId());
                        setConversationId(result.conversationId);
                        setMessages((value) => [
                          ...value,
                          { role: "user", text: instruction },
                          {
                            role: "assistant",
                            text: "記事の案を作成しました。下のプレビューを確認してください。追加の依頼もできます。",
                          },
                        ]);
                        setInstruction("");
                        setTurnId(createRequestId());
                        notify(
                          "記事の案ができました。下のプレビューで確認できます。",
                        );
                      });
                    }}
                  >
                    <label>
                      AIに伝える内容
                      <textarea
                        ref={requestInput}
                        aria-label="AIに伝える内容"
                        rows={4}
                        maxLength={10000}
                        value={instruction}
                        disabled={blocked}
                        onChange={(event) => {
                          setInstruction(event.target.value);
                          setTurnId(createRequestId());
                        }}
                        placeholder="例：この写真を使って、秋のおすすめネイルを紹介してください。[[spec.md]]の情報も参考にしてください。"
                      />
                    </label>
                    <div className="article-composer-actions">
                      <button
                        type="button"
                        disabled={blocked}
                        onClick={() => setImageOpen(true)}
                      >
                        📎 画像を添付
                      </button>
                      <label>
                        資料を選ぶ
                        <select
                          aria-label="記事の参照ファイル"
                          value=""
                          disabled={blocked}
                          onChange={(event) => {
                            if (event.target.value)
                              insertReference(event.target.value);
                          }}
                        >
                          <option value="">お店のファイルから選ぶ</option>
                          {files.map((file) => (
                            <option key={file.path} value={file.path}>
                              {file.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="primary"
                        disabled={blocked || !instruction.trim()}
                      >
                        {busy ? "AIが記事を作成しています…" : "送信する"}
                      </button>
                    </div>
                    <p className="small muted">
                      [[パス]]でお店のファイルを参照できます。画像を添付すると、参照するパスが入力されます。
                    </p>
                  </form>
                  <ArticleImageChooser
                    shopId={shop.id}
                    open={imageOpen}
                    close={() => setImageOpen(false)}
                    select={(image) => insertReference(image.path)}
                    onBusy={setMediaBusy}
                  />
                  {content.body && (
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => setMethod("write")}
                    >
                      自分で編集する
                    </button>
                  )}
                </section>
              ) : (
                <>
                  <label className="field">
                    <span>タイトル</span>
                    <input
                      maxLength={160}
                      value={content.title}
                      disabled={blocked}
                      onChange={(event) => update("title", event.target.value)}
                      placeholder="秋の新しいデザインができました"
                    />
                  </label>
                  <Suspense
                    fallback={
                      <p role="status">記事の編集画面を読み込んでいます…</p>
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
                </>
              )}
              <p className="small muted">
                記事の紹介文とアドレスは、保存時にAIが自動で作成します。既存記事のアドレスは維持します。
              </p>
              <button
                className="primary"
                disabled={
                  blocked ||
                  !shop.published ||
                  !content.title.trim() ||
                  !content.body.trim() ||
                  !content.date
                }
                onClick={() =>
                  void run(async () => {
                    try {
                      const fields = postContentSchema
                        .omit({ slug: true, excerpt: true })
                        .parse(content);
                      const metadata = await api<{
                        slug: string;
                        excerpt: string;
                      }>(`${base}/metadata`, {
                        content: fields,
                        requestId: saveId,
                        ...(current
                          ? { postId: current.id, version: current.version }
                          : {}),
                      });
                      const parsed = postContentSchema.parse({
                        ...fields,
                        ...metadata,
                      });
                      const saved = await api<Post>(
                        current ? `${base}/${current.id}/save` : base,
                        current
                          ? {
                              version: current.version,
                              content: parsed,
                              publish: true,
                            }
                          : {
                              content: parsed,
                              publish: true,
                              requestId: saveId,
                              autoMetadata: true,
                            },
                      );
                      await accept(saved);
                      notify("保存して本番に反映しました。");
                    } catch (error) {
                      await load().catch(() => {});
                      throw error;
                    }
                  })
                }
              >
                保存
              </button>
            </>
          )}
          {!clean && current && (
            <p className="small muted">
              未保存の変更があります。保存すると本番に反映されます。
            </p>
          )}
          {current?.published && (
            <div className="post-published-note">
              <b>公開中のページ</b>
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
                      "記事を非公開にしました。下書きと履歴は残っています。",
                    );
                  })
                }
              >
                非公開にする
              </button>
            </div>
          )}
        </section>
        {method && (
          <section className="panel post-preview" aria-label="記事のプレビュー">
            <h2>記事のプレビュー</h2>
            <p className="small muted">
              入力中の記事を確認できます。保存すると本番に反映されます。
            </p>
            {content.title || content.body ? (
              <PostContent
                post={{ ...content, excerpt: clean ? content.excerpt : "" }}
                imageBase={`/api/shops/${shop.id}/images`}
              />
            ) : (
              <p className="empty">入力した記事がここに表示されます。</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export function RecentPosts({
  posts,
  basePath,
  navigate,
}: {
  posts: PostSummary[];
  basePath: string;
  navigate: Navigate;
}) {
  if (!posts.length) return null;
  return (
    <section className="panel recent-posts">
      <div className="section-top">
        <h2>お店からのお便り</h2>
        <a
          data-article-link
          href={`${basePath}/blogs`}
          onClick={(e) => {
            e.preventDefault();
            navigate(`${basePath}/blogs`);
          }}
        >
          ブログ一覧 →
        </a>
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
        <h2>記事を表示できません</h2>
        <p role="alert">{error}</p>
        <a
          data-article-link
          href={`${basePath}/${category}`}
          onClick={(e) => {
            e.preventDefault();
            navigate(`${basePath}/${category}`);
          }}
        >
          一覧に戻る
        </a>
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
          ← {postLabel(category)}の一覧
        </a>
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
            お店の予約ページへ →
          </a>
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
          ? "お店の日々や、季節のおすすめをお届けします。"
          : "お店からの大切なご案内です。"}
      </p>
      {!result ? (
        <p>記事を読み込んでいます…</p>
      ) : (
        <>
          {!result.items.length && (
            <p className="empty">記事はまだありません。</p>
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
                <p>{p.excerpt}</p>
                <span className="small">続きを読む →</span>
              </a>
            ))}
          </div>
          {result.total > result.size && (
            <div className="actions">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                前のページ
              </button>
              <span>
                {page} / {Math.ceil(result.total / result.size)}
              </span>
              <button
                disabled={page * result.size >= result.total}
                onClick={() => setPage((p) => p + 1)}
              >
                次のページ
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
