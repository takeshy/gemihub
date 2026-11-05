import React, { useRef, useState } from "react";
import { tr } from "../shared/i18n";
import { articleImageUrl } from "../server/post-images";
import { ArticleImageChooser, type ArticleImage } from "./ArticleImages";

export function ArticleTextEditor({
  shopId,
  value,
  onChange,
  disabled,
  onBusy,
}: {
  shopId: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const selection = useRef({ start: 0, end: 0 });
  function insertImage(image: ArticleImage) {
    const { start, end } = selection.current;
    const before = value.slice(0, start), after = value.slice(end);
    const alt = image.name.replace(/[\\[\]\r\n]/g, "_");
    const markdown = `${before && !before.endsWith("\n\n") ? "\n\n" : ""}![${alt}](${articleImageUrl(image.id)})\n\n`;
    onChange(before + markdown + after);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(start + markdown.length, start + markdown.length);
    });
  }
  return (
    <div className="article-text-editor">
      <label className="field">
        <span>{tr("記事の本文")}</span>
        <textarea
          ref={input}
          rows={14}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={tr("記事の本文を書いてください")}
        />
      </label>
      <div className="article-text-images">
        <button type="button" disabled={disabled} onClick={() => {
          selection.current = {
            start: input.current?.selectionStart ?? value.length,
            end: input.current?.selectionEnd ?? value.length,
          };
          setImageOpen(true);
        }}>
          {tr("画像を追加")}
        </button>
        <p className="small muted">{tr("画像は何度でも追加できます。追加した画像は下書き保存後の画面で確認できます。")}</p>
      </div>
      <ArticleImageChooser
        shopId={shopId}
        open={imageOpen}
        close={() => setImageOpen(false)}
        select={insertImage}
        onBusy={onBusy}
      />
    </div>
  );
}
