import React from "react";
import type { ShopPage } from "../server/pages";
import { MenuImage } from "./MenuImage";
import { Presentation } from "./Presentation";
import { tr } from "../shared/i18n";
export function CustomPage({ page, imageBase, imageSuffix }: { page: ShopPage; imageBase?: string; imageSuffix?: string }) {
  return <article className={`panel custom-page custom-page-${page.layout}`}>
    <h1>{page.title}</h1>
    {page.imageId && imageBase ? <MenuImage imageId={page.imageId} imageBase={imageBase} suffix={imageSuffix} name={page.title} className="managed-hero-image" /> : page.imageUrl && <img className="salon-image" src={page.imageUrl} alt={page.title} />}
    <Presentation design={{ html: page.body, css: page.css || "" }} slots={{}} imageBase={imageBase} imageSuffix={imageSuffix} fallback={<p className="muted">{tr("このページの内容を表示できませんでした。")}</p>} />
  </article>;
}
