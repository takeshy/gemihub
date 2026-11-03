import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./AssistantAnswer.css";

/** Format AI answers while keeping raw HTML and remote images out of the chat. */
export function AssistantAnswer({ text }: { text: string }) {
  return <div className="assistant-markdown"><Markdown
    remarkPlugins={[remarkGfm]}
    skipHtml
    disallowedElements={["img"]}
    components={{
      a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      table: ({ children }) => <div className="assistant-table"><table>{children}</table></div>,
    }}
  >{text}</Markdown></div>;
}
