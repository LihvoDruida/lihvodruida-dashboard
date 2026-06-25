import type { ReactNode } from "react";

const DISCORD_MARKDOWN_BLOCK_LIMIT = 160;

type InlineMarkdownToken = {
  index: number;
  length: number;
  priority: number;
  render: (key: string) => ReactNode;
};

function isEscaped(value: string, index: number) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function unescapeDiscordText(value: string) {
  return value.replace(/\\([\\`*_~|>\[\]()#-])/g, "$1");
}

function pushPlain(nodes: ReactNode[], value: string) {
  if (value) nodes.push(unescapeDiscordText(value));
}

function findMarkdownToken(
  value: string,
  regex: RegExp,
  priority: number,
  render: (match: RegExpExecArray, key: string) => ReactNode,
): InlineMarkdownToken | null {
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(value))) {
    if (!match[0]) {
      regex.lastIndex += 1;
      continue;
    }

    if (isEscaped(value, match.index)) continue;

    return {
      index: match.index,
      length: match[0].length,
      priority,
      render: (key: string) => render(match as RegExpExecArray, key),
    };
  }

  return null;
}

function formatDiscordTimestamp(unixSeconds: string, style = "f") {
  const timestamp = Number(unixSeconds);
  if (!Number.isFinite(timestamp)) return `<t:${unixSeconds}${style ? `:${style}` : ""}>`;

  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return `<t:${unixSeconds}${style ? `:${style}` : ""}>`;

  if (style === "t") return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" }).format(date);
  if (style === "T") return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
  if (style === "d") return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  if (style === "D") return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "long", year: "numeric" }).format(date);
  if (style === "R") return "відносний час";
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function firstInlineToken(value: string): InlineMarkdownToken | null {
  const patterns: InlineMarkdownToken[] = [
    findMarkdownToken(value, /`([^`\n]+?)`/g, 0, (match, key) => <code key={key}>{match[1]}</code>),
    findMarkdownToken(value, /\[([^\]\n]+?)\]\((https?:\/\/[^\s<>)]+)\)/gi, 1, (match, key) => (
      <a className="discord-preview-link" key={key} href={match[2]} target="_blank" rel="noreferrer">
        {renderDiscordInlineMarkdown(match[1], `${key}-link`)}
      </a>
    )),
    findMarkdownToken(value, /<@&(\d{16,25})>/g, 2, (_match, key) => <span className="discord-preview-mention" key={key}>@role</span>),
    findMarkdownToken(value, /<@!?(\d{16,25})>/g, 2, (_match, key) => <span className="discord-preview-mention" key={key}>@user</span>),
    findMarkdownToken(value, /<#(\d{16,25})>/g, 2, (_match, key) => <span className="discord-preview-mention" key={key}>#channel</span>),
    findMarkdownToken(value, /<t:(\d{1,12})(?::([tTdDfFR]))?>/g, 2, (match, key) => <span className="discord-preview-timestamp" key={key}>{formatDiscordTimestamp(match[1], match[2] || "f")}</span>),
    findMarkdownToken(value, /<a?:([a-zA-Z0-9_]{2,32}):\d{16,25}>/g, 2, (match, key) => <span className="discord-preview-emoji" key={key}>:{match[1]}:</span>),
    findMarkdownToken(value, /\|\|([\s\S]+?)\|\|/g, 3, (match, key) => (
      <span className="discord-preview-spoiler" key={key}>{renderDiscordInlineMarkdown(match[1], `${key}-spoiler`)}</span>
    )),
    findMarkdownToken(value, /__\*\*\*([\s\S]+?)\*\*\*__/g, 4, (match, key) => (
      <u key={key}><strong><em>{renderDiscordInlineMarkdown(match[1], `${key}-ubi`)}</em></strong></u>
    )),
    findMarkdownToken(value, /__\*\*([\s\S]+?)\*\*__/g, 4, (match, key) => (
      <u key={key}><strong>{renderDiscordInlineMarkdown(match[1], `${key}-ub`)}</strong></u>
    )),
    findMarkdownToken(value, /__\*([\s\S]+?)\*__/g, 4, (match, key) => (
      <u key={key}><em>{renderDiscordInlineMarkdown(match[1], `${key}-ui`)}</em></u>
    )),
    findMarkdownToken(value, /\*\*\*([\s\S]+?)\*\*\*/g, 5, (match, key) => (
      <strong key={key}><em>{renderDiscordInlineMarkdown(match[1], `${key}-bi`)}</em></strong>
    )),
    findMarkdownToken(value, /\*\*([\s\S]+?)\*\*/g, 6, (match, key) => (
      <strong key={key}>{renderDiscordInlineMarkdown(match[1], `${key}-bold`)}</strong>
    )),
    findMarkdownToken(value, /__([\s\S]+?)__/g, 7, (match, key) => (
      <u key={key}>{renderDiscordInlineMarkdown(match[1], `${key}-underline`)}</u>
    )),
    findMarkdownToken(value, /~~([\s\S]+?)~~/g, 8, (match, key) => (
      <s key={key}>{renderDiscordInlineMarkdown(match[1], `${key}-strike`)}</s>
    )),
    findMarkdownToken(value, /(^|[^*\\])\*([^*\n]+?)\*(?!\*)/g, 9, (match, key) => (
      <span key={key}>{match[1]}<em>{renderDiscordInlineMarkdown(match[2], `${key}-italic`)}</em></span>
    )),
    findMarkdownToken(value, /(^|[^\w_\\])_([^_\n]+?)_(?![\w_])/g, 10, (match, key) => (
      <span key={key}>{match[1]}<em>{renderDiscordInlineMarkdown(match[2], `${key}-italic-u`)}</em></span>
    )),
    findMarkdownToken(value, /https?:\/\/[^\s<]+[^<.,:;"')\]\s]/gi, 11, (match, key) => (
      <a className="discord-preview-link" key={key} href={match[0]} target="_blank" rel="noreferrer">{match[0]}</a>
    )),
  ].filter(Boolean) as InlineMarkdownToken[];

  if (!patterns.length) return null;

  return patterns.sort((a, b) => (a.index - b.index) || (a.priority - b.priority))[0];
}

function renderDiscordInlineMarkdown(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = value;
  let cursor = 0;

  while (rest) {
    const token = firstInlineToken(rest);
    if (!token) {
      pushPlain(nodes, rest);
      break;
    }

    if (token.index > 0) pushPlain(nodes, rest.slice(0, token.index));
    nodes.push(token.render(`${keyPrefix}-${cursor}-${token.index}`));
    rest = rest.slice(token.index + token.length);
    cursor += token.index + token.length;
  }

  return nodes;
}

function parseDiscordCodeFence(value: string) {
  const match = value.match(/^```([a-z0-9_+.-]*)[ \t]*\n?([\s\S]*?)```$/i);
  return {
    language: match?.[1] ? match[1].toLowerCase() : "",
    code: match?.[2] ?? value.replace(/^```[a-z0-9_+.-]*[ \t]*\n?/i, "").replace(/```$/, ""),
  };
}

function renderDiscordLineContent(value: string, keyPrefix: string) {
  return renderDiscordInlineMarkdown(value, keyPrefix);
}

function renderDiscordTextLines(value: string, keyPrefix: string) {
  const nodes: ReactNode[] = [];
  const lines = value.split("\n").slice(0, DISCORD_MARKDOWN_BLOCK_LIMIT);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex].replace(/\r$/, "");
    const line = rawLine.trimEnd();
    const key = `${keyPrefix}-line-${lineIndex}-${line.slice(0, 12)}`;
    const inlineKey = `${keyPrefix}-inline-${lineIndex}`;

    if (!line.trim()) {
      nodes.push(<span className="discord-preview-gap" key={key} />);
      continue;
    }

    const multiQuoteMatch = line.match(/^>>>\s?(.*)$/);
    if (multiQuoteMatch) {
      const quoteLines = [multiQuoteMatch[1], ...lines.slice(lineIndex + 1).map((nextLine) => nextLine.replace(/\r$/, "").trimEnd())];
      nodes.push(
        <div className="discord-preview-quote discord-preview-quote--multi" key={key}>
          {quoteLines.map((quoteLine, quoteIndex) => (
            quoteLine.trim()
              ? <p key={`${key}-quote-${quoteIndex}`}>{renderDiscordLineContent(quoteLine, `${inlineKey}-quote-${quoteIndex}`)}</p>
              : <span className="discord-preview-gap" key={`${key}-quote-${quoteIndex}`} />
          ))}
        </div>
      );
      break;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      nodes.push(<p className="discord-preview-quote" key={key}>{renderDiscordLineContent(quoteMatch[1], inlineKey)}</p>);
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      nodes.push(
        <div className={`discord-preview-heading discord-preview-heading--${level}`} role="heading" aria-level={level} key={key}>
          {renderDiscordLineContent(headingMatch[2], inlineKey)}
        </div>
      );
      continue;
    }

    const subtextMatch = line.match(/^-#\s+(.+)$/);
    if (subtextMatch) {
      nodes.push(<p className="discord-preview-subtext" key={key}>{renderDiscordLineContent(subtextMatch[1], inlineKey)}</p>);
      continue;
    }

    const unorderedMatch = line.match(/^\s{0,3}[-*+]\s+(.+)$/);
    if (unorderedMatch) {
      nodes.push(
        <p className="discord-preview-list discord-preview-list--unordered" key={key}>
          <span className="discord-preview-list-bullet">•</span>
          <span>{renderDiscordLineContent(unorderedMatch[1], inlineKey)}</span>
        </p>
      );
      continue;
    }

    const orderedMatch = line.match(/^\s{0,3}(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      nodes.push(
        <p className="discord-preview-list discord-preview-list--ordered" key={key}>
          <span className="discord-preview-list-bullet">{orderedMatch[1]}.</span>
          <span>{renderDiscordLineContent(orderedMatch[2], inlineKey)}</span>
        </p>
      );
      continue;
    }

    nodes.push(<p key={key}>{renderDiscordLineContent(line, inlineKey)}</p>);
  }

  return nodes;
}

export function DiscordMarkdown({ value, compact = false }: { value: string; compact?: boolean }) {
  const blocks = value.split(/(```[\s\S]*?```)/g).slice(0, DISCORD_MARKDOWN_BLOCK_LIMIT);

  return (
    <div className={compact ? "discord-preview-markdown discord-preview-markdown--compact" : "discord-preview-markdown"}>
      {blocks.map((block, blockIndex) => {
        const blockKey = `block-${blockIndex}`;
        if (!block) return null;
        if (block.startsWith("```")) {
          const parsed = parseDiscordCodeFence(block);
          return (
            <pre className="discord-preview-codeblock" data-language={parsed.language || undefined} key={blockKey}>
              <code>{parsed.code}</code>
            </pre>
          );
        }

        return renderDiscordTextLines(block, blockKey);
      })}
    </div>
  );
}

