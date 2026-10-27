/** Rebuild previews when their cached inputs change; coalesce bulk cache events. */
export function watchPreviewDependencies(
  target: EventTarget,
  getFileIds: () => ReadonlySet<string>,
  refresh: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const handleChange = (event: Event) => {
    const detail = (event as CustomEvent<{ fileId?: string; fileIds?: string[] }>).detail;
    const changedIds = detail?.fileIds ?? (detail?.fileId ? [detail.fileId] : null);
    if (changedIds && !changedIds.some((id) => getFileIds().has(id))) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, 50);
  };
  const events = [
    "file-modified", "file-cached", "file-restored", "files-pulled",
    "sync-complete", "tree-meta-updated", "pending-files-created",
  ];
  for (const event of events) target.addEventListener(event, handleChange);
  return () => {
    clearTimeout(timer);
    for (const event of events) target.removeEventListener(event, handleChange);
  };
}
