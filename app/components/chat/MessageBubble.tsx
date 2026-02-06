"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown, ChevronRight, Download, Paperclip, FileText, Wrench, BookOpen } from "lucide-react";
import { ICON } from "~/utils/icon-sizes";
import type { Message, Attachment, GeneratedImage, ToolCall } from "~/types/chat";

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ThinkingSection({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        {expanded ? <ChevronDown size={ICON.MD} /> : <ChevronRight size={ICON.MD} />}
        Thinking
      </button>
      {expanded && (
        <div className="mt-1 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400">
          <pre className="whitespace-pre-wrap break-words font-sans">{thinking}</pre>
        </div>
      )}
    </div>
  );
}

function ToolCallBadges({ toolCalls }: { toolCalls: ToolCall[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-1">
      {toolCalls.map((tc) => (
        <span
          key={tc.id}
          className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
        >
          <Wrench size={10} />
          {tc.name}
        </span>
      ))}
    </div>
  );
}

function RagSourcesList({ sources }: { sources: string[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs font-medium text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
      >
        {expanded ? <ChevronDown size={ICON.MD} /> : <ChevronRight size={ICON.MD} />}
        <BookOpen size={ICON.SM} />
        RAG Sources ({sources.length})
      </button>
      {expanded && (
        <ul className="mt-1 space-y-0.5 rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
          {sources.map((source, i) => (
            <li key={i} className="truncate">
              {source}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GeneratedImageDisplay({ image }: { image: GeneratedImage }) {
  const dataUrl = `data:${image.mimeType};base64,${image.data}`;

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = dataUrl;
    const ext = image.mimeType.split("/")[1] || "png";
    link.download = `generated-image.${ext}`;
    link.click();
  };

  return (
    <div className="group relative mb-2 inline-block">
      <img
        src={dataUrl}
        alt="Generated image"
        className="max-h-80 max-w-full rounded-lg border border-gray-200 dark:border-gray-700"
      />
      <button
        onClick={handleDownload}
        className="absolute right-2 top-2 rounded-md bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
        aria-label="Download image"
      >
        <Download size={ICON.MD} />
      </button>
    </div>
  );
}

function AttachmentDisplay({ attachment }: { attachment: Attachment }) {
  if (attachment.type === "image") {
    const dataUrl = `data:${attachment.mimeType};base64,${attachment.data}`;
    return (
      <div className="mb-2">
        <img
          src={dataUrl}
          alt={attachment.name}
          className="max-h-48 max-w-full rounded-lg border border-gray-200 dark:border-gray-700"
        />
        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          {attachment.name}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
      {attachment.type === "pdf" ? (
        <FileText size={ICON.SM} />
      ) : (
        <Paperclip size={ICON.SM} />
      )}
      {attachment.name}
    </div>
  );
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 md:max-w-[75%] ${
          isUser
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
        }`}
      >
        {/* Attachments (shown for user messages) */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-2">
            {message.attachments.map((att, i) => (
              <AttachmentDisplay key={i} attachment={att} />
            ))}
          </div>
        )}

        {/* Thinking section (assistant only) */}
        {!isUser && message.thinking && (
          <ThinkingSection thinking={message.thinking} />
        )}

        {/* Tool calls (assistant only) */}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallBadges toolCalls={message.toolCalls} />
        )}

        {/* RAG sources (assistant only) */}
        {!isUser && message.ragSources && message.ragSources.length > 0 && (
          <RagSourcesList sources={message.ragSources} />
        )}

        {/* Message content */}
        <div
          className={`prose prose-sm max-w-none break-words ${
            isUser
              ? "prose-invert"
              : "dark:prose-invert"
          }`}
        >
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>

        {/* Generated images (assistant only) */}
        {!isUser &&
          message.generatedImages &&
          message.generatedImages.length > 0 && (
            <div className="mt-2">
              {message.generatedImages.map((img, i) => (
                <GeneratedImageDisplay key={i} image={img} />
              ))}
            </div>
          )}

        {/* Streaming indicator */}
        {isStreaming && !isUser && (
          <div className="mt-1 flex items-center gap-1">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500 [animation-delay:150ms]" />
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500 [animation-delay:300ms]" />
          </div>
        )}

        {/* Timestamp */}
        <div
          className={`mt-1.5 text-[10px] ${
            isUser
              ? "text-blue-200"
              : "text-gray-400 dark:text-gray-500"
          }`}
        >
          {formatTimestamp(message.timestamp)}
          {!isUser && message.model && (
            <span className="ml-1.5">{message.model}</span>
          )}
        </div>
      </div>
    </div>
  );
}
