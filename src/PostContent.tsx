import { tr } from "../shared/i18n";
import React from "react";
import Markdown,{defaultUrlTransform} from "react-markdown";
import { MenuImage } from "./MenuImage";
import { articleImageId } from "../server/post-images";
import type { MenuImageData } from "../server/menu-image-domain";
import type { PostContent as Content } from "../server/post-domain";
import { postLabel } from "../server/post-domain";
/** `imageSources` maps article image ids to URLs (static pages); `inlineImages` embeds them (offline copies). */
export function PostContent({ post, imageBase, inlineImages, imageSources }: { post: Content; imageBase?:string; inlineImages?:Record<string,MenuImageData>; imageSources?:Record<string,string> }) {
  return (
    <article className="post-content">
      <div className="post-meta">
        <span className="pill">{postLabel(post.category)}</span>
        <time dateTime={post.date}>{post.date.replaceAll("-", ".")}</time>
      </div>
      <h1>{post.title}</h1>
      <div className="post-markdown">
        <Markdown
          skipHtml
          urlTransform={(url,key)=>key === "src" && articleImageId(url) ? url : defaultUrlTransform(url)}
          components={{img:({src,alt})=>{const id=articleImageId(typeof src === "string" ? src : "");if(!id)return null;const image=inlineImages?.[id];const source=imageSources?.[id]||(image&&`data:${image.mimeType};base64,${image.data}`);return source?<img src={source} alt={alt||tr("記事の画像")}/>:imageBase?<MenuImage imageId={id} imageBase={imageBase} name={alt||tr("記事")} className="article-managed-image"/>:null;}}}
          disallowedElements={[
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
