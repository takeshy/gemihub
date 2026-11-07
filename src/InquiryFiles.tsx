import { useRef, useState } from "react";
import { tr } from "../shared/i18n";
import { customerFileLimit, customerTotalFileLimit, type CustomerAttachment } from "../server/customers";
import type { InquiryFileInput } from "../shared/inquiry-files";
import { CustomerFile } from "./CustomerNotes";

export function useInquiryFiles() {
  const [files, setFiles] = useState<File[]>([]);
  const snapshot = useRef<{ files: File[]; contents: ReturnType<typeof readInquiryFiles> } | undefined>(undefined);
  return {
    files, setFiles,
    clear: () => { snapshot.current = undefined; setFiles([]); },
    /** A retry after a lost response resends the same bytes, so it keeps its request ID even if the file changed on disk. */
    read: () => {
      if (snapshot.current?.files !== files) {
        const contents = readInquiryFiles(files);
        contents.catch(() => { snapshot.current = undefined; });
        snapshot.current = { files, contents };
      }
      return snapshot.current.contents;
    },
  };
}
async function readInquiryFiles(files: File[]): Promise<{ files?: InquiryFileInput[] }> {
  if (!files.length) return {};
  return { files: await Promise.all(files.map(async file => ({ name: file.name, mimeType: file.type || "application/octet-stream", data: await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error(tr("{0} を読み込めませんでした", file.name)));
    reader.readAsDataURL(file);
  }) }))) };
}
export function InquiryFilePicker({ selection, disabled }: { selection: ReturnType<typeof useInquiryFiles>; disabled: boolean }) {
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  return <div className="inquiry-file-picker">
    <label>{tr("画像・ファイルを添付")}<input ref={input} type="file" multiple disabled={disabled} onChange={event => {
      const next = [...selection.files, ...Array.from(event.target.files || [])];
      setError("");
      if (next.length > 5 || next.some(file => file.size > customerFileLimit) || next.reduce((sum, file) => sum + file.size, 0) > customerTotalFileLimit)
        setError(tr("添付は5ファイルまで、1ファイル5MB・合計10MB以内にしてください。"));
      else selection.setFiles(next);
      if (input.current) input.current.value = "";
    }} /></label>
    <p className="small muted">{tr("5ファイルまで。1ファイル5MB・合計10MB以内。")}</p>
    {error && <p className="alert" role="alert">{error}</p>}
    {!!selection.files.length && <ul>{selection.files.map((file, index) => <li key={index}>{file.name} <button type="button" disabled={disabled} aria-label={tr("{0} の添付を取り消す", file.name)} onClick={() => { selection.setFiles(selection.files.filter((_, i) => i !== index)); setError(""); }}>{tr("取り消す")}</button></li>)}</ul>}
  </div>;
}
export function InquiryAttachments({ files, shopId, inquiryId }: { files?: CustomerAttachment[]; shopId: string; inquiryId: string }) {
  return files?.length ? <div className="customer-attachments">{files.map(file => <CustomerFile key={file.id} file={file} path={`/api/shops/${shopId}/inquiries/${inquiryId}/files/${file.id}`} />)}</div> : null;
}
