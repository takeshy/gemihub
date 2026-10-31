import React, { useEffect, useState, useRef } from "react";
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
  demo,
}: {
  shop: Workspace;
  run: Run;
  busy: boolean;
  notify: (message: string) => void;
  reload: () => Promise<unknown>;
  demo: boolean;
}) {
  const api = useApi();
  const [posts, setPosts] = useState<Post[]>([]);
  const [current, setCurrent] = useState<Post>();
  const [content, setContent] = useState<Content>(freshContent);
  const [review, setReview] = useState<number>();
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (review !== undefined)
      previewRef.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
  }, [review]);
  const [instruction, setInstruction] = useState("");
  const [source, setSource] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  const base = `/api/shops/${shop.id}/posts`;
  const clean =
    !!current && JSON.stringify(content) === JSON.stringify(current.draft);
  async function load() {
    const result = await api<Post[]>(base);
    setPosts(result);
    return result;
  }
  useEffect(() => {
    run(async () => {
      await load();
    });
  }, [shop.id]);
  function choose(post?: Post) {
    setCurrent(post);
    setContent(post ? structuredClone(post.draft) : freshContent());
    setReview(undefined);
    setInstruction("");
    setSource("");
  }
  const update = <K extends keyof Content>(key: K, value: Content[K]) => {
    setContent((c) => ({ ...c, [key]: value }));
    setReview(undefined);
  };
  async function accept(post: Post) {
    setCurrent(post);
    setContent(structuredClone(post.draft));
    setReview(undefined);
    await load();
    await reload();
  }
  return (
    <div className="blog-editor-layout">
      <div className="panel post-management-list">
        <div className="section-top">
          <h2>お店のお便り</h2>
          <button disabled={!shop.isOwner || busy} onClick={() => choose()}>
            ＋ 新しい記事
          </button>
        </div>
        <p className="small muted">保存前の編集は、お客様には反映されません。</p>
        <button
          className="text-button"
          onClick={() =>
            run(async () => {
              await load();
            })
          }
        >
          一覧を更新
        </button>
        {!posts.length && (
          <p className="empty">最初のお便りを書いてみましょう。</p>
        )}
        {posts.map((post) => (
          <button
            key={post.id}
            className={`post-management-item ${post.id === current?.id ? "selected" : ""}`}
            onClick={() => choose(post)}
          >
            <span className="post-meta">
              <span className="pill">{postLabel(post.draft.category)}</span>
              <small>{post.published ? "公開中" : "下書き・非公開"}</small>
            </span>
            <strong>{post.draft.title}</strong>
            <small>
              {post.draft.date}
              {post.published &&
              JSON.stringify(post.draft) !== JSON.stringify(post.published)
                ? " · 未公開の変更あり"
                : ""}
            </small>
          </button>
        ))}
      </div>
      <div>
        <div className="panel post-editor">
          <span className="eyebrow">BLOG & NEWS</span>
          <h2>{current ? "記事を編集する" : "新しいお便りを書く"}</h2>
          <p className="muted small">
            本文を直接書くか、メモから下書きを作れます。公開前に内容を確認してください。
          </p>
          {!shop.isOwner && (
            <p className="notice">記事の作成・変更・公開は店主が行います。</p>
          )}
          <fieldset disabled={!shop.isOwner || busy}>
            <div className="form-grid">
              <label className="field">
                <span>記事の種類</span>
                <select
                  value={content.category}
                  disabled={!!current?.address}
                  onChange={(e) =>
                    update("category", e.target.value as PostCategory)
                  }
                >
                  <option value="blogs">ブログ</option>
                  <option value="announcements">お知らせ</option>
                </select>
              </label>
              <label className="field">
                <span>記事の日付（表示用）</span>
                <input
                  type="date"
                  value={content.date}
                  disabled={!!current?.address}
                  onChange={(e) => update("date", e.target.value)}
                />
              </label>
            </div>
            <label className="field">
              <span>タイトル</span>
              <input
                value={content.title}
                maxLength={160}
                onChange={(e) => update("title", e.target.value)}
                placeholder="秋の新しいデザインができました"
              />
            </label>
            <label className="field">
              <span>記事のアドレス（英小文字・数字・ハイフン）</span>
              <input
                value={content.slug}
                maxLength={80}
                disabled={!!current?.address}
                onChange={(e) => update("slug", e.target.value)}
                placeholder="autumn-design"
              />
            </label>
            {current?.address && (
              <p className="small muted">
                公開後も同じアドレスで読めるよう、種類・日付・アドレスは固定されます。
              </p>
            )}
            <label className="field">
              <span>短い紹介（一覧に表示）</span>
              <textarea
                rows={2}
                value={content.excerpt}
                maxLength={300}
                onChange={(e) => update("excerpt", e.target.value)}
              />
            </label>
            <label className="field">
              <span>本文（Markdown）</span>
              <textarea
                className="post-body-editor"
                rows={14}
                value={content.body}
                maxLength={20000}
                onChange={(e) => update("body", e.target.value)}
                placeholder={
                  "## 秋の色を、指先に。\n\n新しい季節のデザインをご紹介します。\n\n- くすみカラー\n- さりげないきらめき"
                }
              />
            </label>
            <p className="small muted">
              「## 見出し」「- 箇条書き」「**強調**」などが使えます。HTML
              や画像は使用できません。
            </p>
            <details className="post-writing-help">
              <summary>メモから下書きを作る</summary>
              <label className="field">
                <span>お願いしたいこと</span>
                <textarea
                  rows={2}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="このメモから、お客様向けにやさしい文章で紹介してください"
                />
              </label>
              <label className="field">
                <span>元になるメモ</span>
                <textarea
                  rows={5}
                  value={source}
                  maxLength={20000}
                  onChange={(e) => setSource(e.target.value)}
                />
              </label>
              <label className="field">
                <span>テキスト・Markdown ファイルを読み込む</span>
                <input
                  type="file"
                  accept=".txt,.md,.markdown,text/plain,text/markdown"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      run(async () => {
                        if (file.size > 100000)
                          throw new Error(
                            "ファイルを10万バイト以内にしてください",
                          );
                        const text = await file.text();
                        if (text.length > 20000)
                          throw new Error("メモを2万文字以内にしてください");
                        setSource(text);
                      });
                  }}
                />
              </label>
              <label className="field">
                <span>Google ドライブのメモのリンク</span>
                <input
                  type="url"
                  value={driveUrl}
                  onChange={(e) => setDriveUrl(e.target.value)}
                  placeholder="https://drive.google.com/file/d/.../view"
                />
              </label>
              <button
                disabled={!driveUrl}
                onClick={() =>
                  run(async () => {
                    const note = await api<{ name: string; text: string }>(
                      `${base}/source`,
                      { url: driveUrl },
                    );
                    setSource(note.text);
                    notify(
                      `「${note.name}」を読み込みました。公開する内容を確認してください。`,
                    );
                  })
                }
              >
                Drive のメモを読み込む
              </button>
              <p className="small muted">
                このアプリがアクセスできるメモを読み込めます。読み込めない場合は、本文を貼り付けるかファイルを選んでください。
              </p>
              <button
                className="primary"
                disabled={!instruction.trim()}
                onClick={() =>
                  run(async () => {
                    const proposed = await api<{
                      title: string;
                      excerpt: string;
                      body: string;
                    }>(`${base}/propose`, {
                      instruction,
                      source,
                      title: content.title,
                    });
                    setContent((c) => ({ ...c, ...proposed }));
                    setReview(undefined);
                    notify(
                      "記事の案ができました。プレビューで確認し、保存すると本番に反映されます。",
                    );
                  })
                }
              >
                メモから下書きを提案
              </button>
              {demo && (
                <p className="small muted">
                  未接続のデモではメモを本文にコピーします。文章の生成には
                  Vertex AI の接続が必要です。
                </p>
              )}
            </details>
            <div className="actions">
              <button
                disabled={!shop.published || busy || !shop.isOwner}
                onClick={() =>
                  run(async () => {
                    const parsed = postContentSchema.parse(content);
                    const saved = await api<Post>(
                      current ? `${base}/${current.id}/save` : base,
                      current
                        ? { version: current.version, content: parsed, publish: true }
                        : { content: parsed, publish: true },
                    );
                    await accept(saved);
                    notify(
                      "保存して本番に反映しました。",
                    );
                  })
                }
              >
                保存
              </button>
              <button
                disabled={!content.title.trim() || !content.body.trim()}
                onClick={() => setReview(current?.version || 0)}
              >
                プレビュー
              </button>
            </div>
          </fieldset>
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
                disabled={!shop.isOwner || busy}
                onClick={() =>
                  run(async () => {
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
        </div>
        {review !== undefined && (
          <div ref={previewRef} className="panel post-preview">
            <div className="preview-banner">
              記事のプレビュー · 編集中の内容を確認できます。
            </div>
            <PostContent post={content} />
            <p className="small muted">
              確認して保存すると本番に反映されます。日付は記事の表示日で、予約投稿ではありません。
            </p>
            <button onClick={() => setReview(undefined)}>プレビューを閉じる</button>
            {!shop.published && (
              <p className="small muted">
                先にお店の予約ページを公開してください。
              </p>
            )}
          </div>
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
        <PostContent post={post} />
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
