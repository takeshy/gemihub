import React from "react";
import Markdown from "react-markdown";
import type { ShopPage } from "../server/pages";
import { MenuImage } from "./MenuImage";
export function CustomPage({ page, imageBase, imageSuffix }: { page: ShopPage; imageBase?: string; imageSuffix?: string }) {
  return <article className={`panel custom-page custom-page-${page.layout}`}>
    <h1>{page.title}</h1>
    {page.imageId && imageBase ? <MenuImage imageId={page.imageId} imageBase={imageBase} suffix={imageSuffix} name={page.title} className="managed-hero-image" /> : page.imageUrl && <img className="salon-image" src={page.imageUrl} alt={page.title} />}
    <div className="post-markdown"><Markdown skipHtml disallowedElements={["img", "iframe", "script", "style", "form", "input"]}>{page.body}</Markdown></div>
  </article>;
}
