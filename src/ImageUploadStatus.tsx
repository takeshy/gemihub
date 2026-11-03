import React from "react";
import { tr } from "../shared/i18n";

export function ImageUploadStatus({ name }: { name?: string }) {
  return <div className="image-upload-status" role="status">
    <span className="image-upload-spinner" aria-hidden="true" />
    <div><strong>{tr("画像をアップロードしています…")}</strong>{name && <span className="image-upload-name">{name}</span>}<small>{tr("完了するまで、この画面を開いたままお待ちください。")}</small></div>
  </div>;
}
