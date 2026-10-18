// Initial tree loading and later syncs populate the local file metadata at
// different times. File-backed widgets must observe both to avoid staying empty.
const LOCAL_FILE_EVENTS = [
  "tree-cached",
  "tree-meta-updated",
  "sync-complete",
  "files-pulled",
  "file-modified",
] as const;

export function subscribeLocalFileChanges(target: EventTarget, refresh: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 250);
  };
  for (const event of LOCAL_FILE_EVENTS) target.addEventListener(event, schedule);
  return () => {
    clearTimeout(timer);
    for (const event of LOCAL_FILE_EVENTS) target.removeEventListener(event, schedule);
  };
}
