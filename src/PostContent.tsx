import React from "react";
import Markdown from "react-markdown";
import type { PostContent as Content } from "../server/post-domain";
import { postLabel } from "../server/post-domain";
export function PostContent({ post }: { post: Content }) {
  return (
    <article className="post-content">
      <div className="post-meta">
        <span className="pill">{postLabel(post.category)}</span>
        <time dateTime={post.date}>{post.date.replaceAll("-", ".")}</time>
      </div>
      <h1>{post.title}</h1>
      {post.excerpt && <p className="post-lead">{post.excerpt}</p>}
      <div className="post-markdown">
        <Markdown
          skipHtml
          disallowedElements={[
            "img",
            "iframe",
            "script",
            "style",
            "form",
            "input",
          ]}
        >
          {post.body}
        </Markdown>
      </div>
    </article>
  );
}
