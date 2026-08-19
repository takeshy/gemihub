export interface TimelineAuthor {
  id: string;
  email: string;
}

let activeAuthor: TimelineAuthor | null = null;

function singleLine(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Set from the authenticated loader context before dashboard effects run. */
export function setActiveTimelineAuthor(id: string | null | undefined, email: string | null | undefined): void {
  const normalizedId = singleLine(id);
  const normalizedEmail = singleLine(email);
  activeAuthor = normalizedId || normalizedEmail
    ? { id: normalizedId, email: normalizedEmail }
    : null;
}

export function getActiveTimelineAuthor(): TimelineAuthor | null {
  return activeAuthor;
}

export function timelineAuthorMetadata(author = getActiveTimelineAuthor()): string[] {
  if (!author) return [];
  const lines: string[] = [];
  if (author.id) lines.push(`author-id: ${singleLine(author.id)}`);
  if (author.email) lines.push(`author-email: ${singleLine(author.email)}`);
  return lines;
}
