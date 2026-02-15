const NBSP = "\u00A0";
const BLANK_LINE_MARKER = `\u2060${NBSP}\u2060`;

type FenceInfo = {
  char: "`" | "~";
  length: number;
};

function getFenceInfo(line: string): FenceInfo | null {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
  if (!match) return null;
  const marker = match[1];
  const char = marker[0] as "`" | "~";
  return { char, length: marker.length };
}

function isPlaceholderLine(line: string): boolean {
  return line === BLANK_LINE_MARKER;
}

function isIndentedCodeLine(line: string): boolean {
  return line.startsWith("    ") || line.startsWith("\t");
}

export function toWysiwygMarkdown(markdown: string): string {
  if (!markdown.includes("\n\n\n")) return markdown;

  const lines = markdown.split("\n");
  const out: string[] = [];
  let fence: FenceInfo | null = null;
  let blankRun = 0;
  let prevNonBlankLine: string | null = null;

  const flushBlankRun = (nextNonBlankLine: string | null) => {
    if (blankRun === 0) return;

    // Keep blank lines in fenced code blocks as-is.
    if (fence) {
      for (let i = 0; i < blankRun; i++) out.push("");
      blankRun = 0;
      return;
    }

    // Avoid rewriting blank lines around indented code blocks.
    if (
      (prevNonBlankLine && isIndentedCodeLine(prevNonBlankLine))
      || (nextNonBlankLine && isIndentedCodeLine(nextNonBlankLine))
    ) {
      for (let i = 0; i < blankRun; i++) out.push("");
      blankRun = 0;
      return;
    }

    out.push("");
    for (let i = 1; i < blankRun; i++) {
      out.push(BLANK_LINE_MARKER);
      out.push("");
    }
    blankRun = 0;
  };

  for (const line of lines) {
    if (line === "") {
      blankRun++;
      continue;
    }

    flushBlankRun(line);
    out.push(line);
    prevNonBlankLine = line;

    const marker = getFenceInfo(line);
    if (!marker) continue;
    if (!fence) {
      fence = marker;
      continue;
    }
    if (marker.char === fence.char && marker.length >= fence.length) {
      fence = null;
    }
  }

  flushBlankRun(null);
  return out.join("\n");
}

export function fromWysiwygMarkdown(markdown: string): string {
  if (!markdown.includes(BLANK_LINE_MARKER)) return markdown;

  const lines = markdown.split("\n");
  const out: string[] = [];
  let fence: FenceInfo | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!fence && line === "") {
      let cursor = i;
      let placeholders = 0;

      while (
        cursor + 2 < lines.length &&
        isPlaceholderLine(lines[cursor + 1]) &&
        lines[cursor + 2] === ""
      ) {
        placeholders++;
        cursor += 2;
      }

      if (placeholders > 0) {
        out.push("");
        for (let p = 0; p < placeholders; p++) out.push("");
        i = cursor;
        continue;
      }
    }

    out.push(line);

    const marker = getFenceInfo(line);
    if (!marker) continue;
    if (!fence) {
      fence = marker;
      continue;
    }
    if (marker.char === fence.char && marker.length >= fence.length) {
      fence = null;
    }
  }

  return out.join("\n");
}
