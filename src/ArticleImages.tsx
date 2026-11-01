import { tr } from "../shared/i18n";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApi } from "./api";
import { RequestImagePicker } from "./RequestImagePicker";
import { createRequestId } from "./request-id";
import { articleImagePath } from "../server/post-images";
import { menuImageLimit } from "../server/menu-image-domain";
import type { LibraryImage } from "../server/image-library-domain";
export type ArticleImage = { id: string; name: string; path: string };
export function ArticleImageChooser({
  shopId,
  open,
  close,
  select,
  onBusy,
}: {
  shopId: string;
  open: boolean;
  close: () => void;
  select: (image: ArticleImage) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const api = useApi(),
    dialog = useRef<HTMLDialogElement>(null);
  const [method, setMethod] = useState<"upload">(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [pending, setPending] = useState<{ file: File; requestId: string }>();
  useEffect(() => {
    if (open) {
      setMethod(undefined);
      setError("");
      setPending(undefined);
      dialog.current?.showModal();
    }
  }, [open]);
  async function upload(action: { file: File; requestId: string }) {
    setBusy(true);
    onBusy?.(true);
    setError("");
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error(tr("画像を読み込めません")));
        reader.readAsDataURL(action.file);
      });
      const result = await api<{ imageId: string }>(
        `/api/shops/${shopId}/images`,
        {
          requestId: action.requestId,
          name: action.file.name,
          mimeType: action.file.type,
          data,
        },
      );
      select({
        id: result.imageId,
        name: action.file.name,
        path: articleImagePath(result.imageId, action.file.name),
      });
      setPending(undefined);
      close();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  if (!open) return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="article-image-dialog"
      aria-label={tr("記事に使う画像")}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else close();
      }}
    >
      <div className="section-top">
        <h2>{tr("記事に使う画像")}</h2>
        <button type="button" disabled={busy} onClick={close}>
          {tr("閉じる")}</button>
      </div>
      <p>{tr("画像をアップロードするか、画像管理の画像を選んでください。")}</p>
      <div className="article-image-methods">
        <button
          type="button"
          disabled={busy}
          onClick={() => setMethod("upload")}
        >
          {tr("画像をアップロード")}</button>
        <RequestImagePicker
          shopId={shopId}
          value={[]}
          max={1}
          selectionOnly
          preview={false}
          disabled={busy}
          label={tr("既存の画像から選ぶ")}
          onChange={(ids) => {
            void api<LibraryImage[]>(`/api/shops/${shopId}/images`)
              .then((images) => {
                const image = images.find((image) => image.id === ids[0]);
                if (!image) throw new Error(tr("画像がありません"));
                select({
                  id: image.id,
                  name: image.name,
                  path: articleImagePath(image.id, image.name),
                });
                close();
              })
              .catch((error) => setError(error.message));
          }}
        />
      </div>
      {method === "upload" && (
        <label>
          {tr("記事用の画像ファイル")}<input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (
                file.size > menuImageLimit ||
                ![
                  "image/png",
                  "image/jpeg",
                  "image/gif",
                  "image/webp",
                ].includes(file.type)
              ) {
                setError(tr("5MB以内のPNG・JPEG・GIF・WebP画像を選んでください。"));
                return;
              }
              const action = { file, requestId: createRequestId() };
              setPending(action);
              void upload(action);
            }}
          />
        </label>
      )}
      {busy && <p role="status">{tr("画像を保存しています…")}</p>}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {pending && !busy && error && (
        <button type="button" onClick={() => void upload(pending)}>
          {tr("画像の保存を再試行")}</button>
      )}
    </dialog>,
    document.body,
  );
}
