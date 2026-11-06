import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./AssistantAnswer.css";
import { PeleDiagram } from "./PeleDiagram";
import { tr } from "../shared/i18n";

/** Format AI answers while keeping raw HTML and remote images out of the chat. */
export function AssistantAnswer({ text }: { text: string }) {
  return <div className="assistant-markdown"><Markdown
    remarkPlugins={[remarkGfm]}
    skipHtml
    disallowedElements={["img"]}
    components={{
      pre: ({ children }) => {
        const child = React.Children.toArray(children)[0];
        return React.isValidElement<{ className?: string }>(child) && /language-mermaid/.test(child.props.className || "")
          ? <div className="assistant-code-block">{children}</div> : <pre>{children}</pre>;
      },
      code: ({ className, children }) => /(?:^|\s)language-mermaid(?:\s|$)/.test(className || "")
        ? <PeleDiagram source={String(children).replace(/\n$/, "")} label={tr("回答のグラフ・図")} />
        : <code className={className}>{children}</code>,
      a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      table: ({ children }) => <div className="assistant-table"><table>{children}</table></div>,
    }}
  >{text}</Markdown></div>;
}
