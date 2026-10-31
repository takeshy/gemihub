import React from "react";
import Markdown from "react-markdown";
import type { ShopPage } from "../server/pages";
export function CustomPage({ page }: { page: ShopPage }) {
  return <article className={`panel custom-page custom-page-${page.layout}`}>
    <h1>{page.title}</h1>
    {page.imageUrl && <img className="salon-image" src={page.imageUrl} alt={page.title} />}
    <div className="post-markdown"><Markdown skipHtml disallowedElements={["img", "iframe", "script", "style", "form", "input"]}>{page.body}</Markdown></div>
  </article>;
}
