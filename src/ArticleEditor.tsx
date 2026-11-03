import { tr } from "../shared/i18n";
import React, { useEffect, useRef, useState } from "react";
import { Editable, useEditor } from "wysimark-lite";
import { useApi } from "./api";
import { ArticleImageChooser, type ArticleImage } from "./ArticleImages";
import { articleImageId, articleImageUrl } from "../server/post-images";
import { createRequestId } from "./request-id";
import {
  menuImageLimit,
  type MenuImageData,
} from "../server/menu-image-domain";
export default function ArticleEditor({
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
  const api = useApi();
  const editor = useEditor({
    minHeight: 320,
    disableCodeBlock: true,
    disableTaskList: true,
  });
  const patched = useRef(false),
    urls = useRef(new Map<string, Promise<string>>()),
    allocated = useRef<string[]>([]);
  const [error, setError] = useState("");
  const [pick, setPick] = useState<{ resolve: (url: string | null) => void }>();
  if (!patched.current) {
    patched.current = true;
    const original = editor.normalizeNode;
    editor.normalizeNode = (entry: [unknown, number[]]) => {
      if (entry[1].length === 0 && editor.children.length === 0)
        editor.children = [
          { type: "paragraph", children: [{ text: "" }] },
        ] as typeof editor.children;
      original(entry);
    };
  }
  useEffect(
    () => () => {
      for (const url of allocated.current) URL.revokeObjectURL(url);
    },
    [],
  );
  const resolveImage = async (url: string) => {
    const id = articleImageId(url);
    if (!id)
      return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    if (!urls.current.has(id))
      urls.current.set(
        id,
        api<MenuImageData>(`/api/shops/${shopId}/images/${id}`).then(
          (image) => {
            const blob = URL.createObjectURL(
              new Blob(
                [
                  Uint8Array.from(atob(image.data), (char) =>
                    char.charCodeAt(0),
                  ),
                ],
                { type: image.mimeType },
              ),
            );
            allocated.current.push(blob);
            return blob;
          },
        ),
      );
    return urls.current.get(id)!;
  };
  const selected = (image: ArticleImage) => {
    pick?.resolve(articleImageUrl(image.id));
    setPick(undefined);
  };
  return (
    <div className="article-rich-editor">
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div
        inert={disabled}
        aria-label={tr("記事の本文")}
        className="article-wysimark"
      >
        <Editable
          editor={editor}
          value={value || "\n"}
          throttleInMs={0}
          onChange={onChange}
          placeholder={tr("記事の本文を書いてください")}
          resolveImageSrc={resolveImage}
          onFileSelect={() => new Promise((resolve) => setPick({ resolve }))}
          onImageChange={async (file) => {
            if (
              file.size > menuImageLimit ||
              !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
                file.type,
              )
            )
              throw new Error(tr("5MB以内の画像を選んでください"));
            onBusy(true);
            setError("");
            try {
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () =>
                  resolve(String(reader.result).split(",")[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
              const result = await api<{ imageId: string }>(
                `/api/shops/${shopId}/images`,
                {
                  name: file.name,
                  mimeType: file.type,
                  data,
                  requestId: createRequestId(),
                },
              );
              return articleImageUrl(result.imageId);
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
              throw error;
            } finally {
              onBusy(false);
            }
          }}
        />
      </div>
      <ArticleImageChooser
        shopId={shopId}
        open={!!pick}
        close={() => {
          pick?.resolve(null);
          setPick(undefined);
        }}
        select={selected}
        onBusy={onBusy}
      />
    </div>
  );
}
