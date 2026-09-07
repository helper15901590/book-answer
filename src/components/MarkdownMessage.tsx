import React from 'react';
import Markdown from 'react-markdown';

interface MarkdownMessageProps {
  content: string;
  isUser?: boolean;
  isStreaming?: boolean;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({
  content,
  isUser = false,
  isStreaming = false,
}) => {
  if (isUser) {
    return <div className="whitespace-pre-wrap text-right">{content}</div>;
  }

  // Pre-clean horizontal rule markdown lines like --- or *** or ___ to prevent paragraph cutting dividers
  const cleanedContent = (content || '')
    .replace(/^[\s]*[-*_]{3,}[\s]*$/gm, '');

  return (
    <div className="markdown-preview text-left text-sm leading-relaxed text-gray-900 space-y-2 font-sans overflow-wrap-break-word [&_p]:mb-2 [&_p:last-child]:mb-0 [&_strong]:font-bold [&_strong]:text-gray-950 [&_em]:italic [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2 [&_li]:mb-1 [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mt-2.5 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-bold [&_h3]:mt-2 [&_h3]:mb-1 [&_blockquote]:border-l-3 [&_blockquote]:border-amber-800/40 [&_blockquote]:pl-3 [&_blockquote]:my-2 [&_blockquote]:text-gray-600 [&_blockquote]:italic [&_pre]:bg-gray-900 [&_pre]:text-gray-100 [&_pre]:p-3 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_pre]:my-2 [&_code]:bg-gray-100 [&_code]:text-amber-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-xs [&_a]:text-amber-800 [&_a]:underline [&_hr]:hidden">
      <Markdown components={{ hr: () => null }}>{cleanedContent}</Markdown>
      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 ml-1 bg-[#2c221e] animate-pulse align-middle" />
      )}
    </div>
  );
};

