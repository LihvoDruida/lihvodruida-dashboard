import type { ReactNode } from "react";

// Render the Markdown we permit for guild rules using React's escaped text nodes.
// Deliberately never evaluate raw HTML or use dangerouslySetInnerHTML.
const MAX_MARKDOWN_CHARS = 20_000;
const MAX_BLOCKS = 500;

type Token = { index: number; length: number; render: (key: string) => ReactNode };

function isEscaped(text: string, at: number) {
  let count = 0;
  for (let i = at - 1; i >= 0 && text[i] === "\\"; i--) count += 1;
  return count % 2 === 1;
}

function tokenAt(text: string, depth: number): Token | null {
  const tokens: Token[] = [];
  const offer = (regex: RegExp, render: (match: RegExpExecArray, key: string) => ReactNode) => {
    for (const match of text.matchAll(regex)) {
      if (isEscaped(text, match.index)) continue;
      tokens.push({ index: match.index, length: match[0].length, render: (key) => render(match, key) });
      break;
    }
  };
  offer(/`([^`\n]+)`/g, (match, key) => <code key={key}>{match[1]}</code>);
  offer(/\[([^\]\n]{1,160})\]\(([^\s)]+)\)/g, (match, key) => {
    const url = match[2];
    if (!/^https?:\/\//i.test(url)) return match[0];
    return <a key={key} href={url} target="_blank" rel="noopener noreferrer nofollow">{match[1]}</a>;
  });
  if (depth < 5) {
    offer(/\*\*([^*\n]+)\*\*/g, (match, key) => <strong key={key}>{inline(match[1], key, depth + 1)}</strong>);
    offer(/__([^_\n]+)__/g, (match, key) => <strong key={key}>{inline(match[1], key, depth + 1)}</strong>);
    offer(/~~([^~\n]+)~~/g, (match, key) => <s key={key}>{inline(match[1], key, depth + 1)}</s>);
    offer(/\*([^*\n]+)\*/g, (match, key) => <em key={key}>{inline(match[1], key, depth + 1)}</em>);
    offer(/(?<!\w)_([^_\n]+)_(?!\w)/g, (match, key) => <em key={key}>{inline(match[1], key, depth + 1)}</em>);
  }
  return tokens.sort((a, b) => a.index - b.index || b.length - a.length)[0] || null;
}

function inline(value: string, key: string, depth = 0): ReactNode[] {
  const nodes: ReactNode[] = [];
  let text = value;
  let offset = 0;
  let tokenCount = 0;
  while (text && tokenCount++ < 1500) {
    const token = tokenAt(text, depth);
    if (!token) { nodes.push(text.replace(/\\([\\`*_~\[\]()>#-])/g, "$1")); break; }
    if (token.index) nodes.push(text.slice(0, token.index).replace(/\\([\\`*_~\[\]()>#-])/g, "$1"));
    nodes.push(token.render(`${key}-${offset}`));
    offset += token.index + token.length;
    text = text.slice(token.index + token.length);
  }
  return nodes;
}

const list = (line: string) => line.match(/^\s{0,3}([-+*]|\d+\.)\s+(.+)$/);
const fence = (line: string) => /^\s{0,3}```([a-z0-9_-]*)\s*$/i.test(line);
const heading = (line: string) => line.match(/^\s{0,3}(#{1,4})\s+(.+)$/);
const divider = (line: string) => /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
const quote = (line: string) => /^\s{0,3}>\s?/.test(line);
const delimiter = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
const cells = (line: string) => line.replace(/^\s*\||\|\s*$/g, "").split("|").map((cell) => cell.trim());
const special = (line: string) => !line.trim() || fence(line) || heading(line) || divider(line) || quote(line) || Boolean(list(line));

export function StaticMarkdown({ value }: { value: string }) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").slice(0, MAX_MARKDOWN_CHARS).split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length && blocks.length < MAX_BLOCKS) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    const key = `md-${i}`;
    if (fence(line)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !fence(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i += 1;
      blocks.push(<pre key={key}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const h = heading(line);
    if (h) {
      const body = inline(h[2], key);
      blocks.push(h[1].length === 1 ? <h2 key={key}>{body}</h2> : h[1].length === 2 ? <h3 key={key}>{body}</h3> : <h4 key={key}>{body}</h4>);
      i += 1; continue;
    }
    if (divider(line)) { blocks.push(<hr key={key} />); i += 1; continue; }
    if (quote(line)) {
      const texts: string[] = [];
      while (i < lines.length && quote(lines[i])) texts.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      blocks.push(<blockquote key={key}>{texts.map((text, n) => <p key={n}>{inline(text, `${key}-${n}`)}</p>)}</blockquote>);
      continue;
    }
    const item = list(line);
    if (item) {
      const ordered = /^\d/.test(item[1]);
      const values: string[] = [];
      const firstNumber = ordered ? Number.parseInt(item[1], 10) : 1;
      while (i < lines.length) {
        const next = list(lines[i]);
        if (!next || /^\d/.test(next[1]) !== ordered) break;
        values.push(next[2]); i += 1;
      }
      const children = values.map((text, n) => <li key={n}>{inline(text, `${key}-${n}`)}</li>);
      blocks.push(ordered ? <ol key={key} start={firstNumber}>{children}</ol> : <ul key={key}>{children}</ul>);
      continue;
    }
    // A compact, escaped pipe-table subset for schedules and responsibilities.
    if (i + 1 < lines.length && line.includes("|") && delimiter(lines[i + 1])) {
      const headers = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push(<div className="static-markdown-table-wrap" key={key}><table><thead><tr>{headers.map((v, n) => <th key={n}>{inline(v, `${key}-h-${n}`)}</th>)}</tr></thead><tbody>{rows.map((row, r) => <tr key={r}>{headers.map((_, c) => <td key={c}>{inline(row[c] || "", `${key}-${r}-${c}`)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const paragraphs = [line];
    i += 1;
    while (i < lines.length && !special(lines[i]) && !(i + 1 < lines.length && lines[i].includes("|") && delimiter(lines[i + 1]))) paragraphs.push(lines[i++]);
    blocks.push(<p key={key}>{inline(paragraphs.join(" ").trim(), key)}</p>);
  }
  return <div className="static-markdown-content">{blocks}</div>;
}
