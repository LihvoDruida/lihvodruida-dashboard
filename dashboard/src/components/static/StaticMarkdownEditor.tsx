"use client";

import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { StaticMarkdown } from "./StaticMarkdown";
import styles from "./static.module.css";

type EditorProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};
type Tool = { label: string; title: string; before: string; after: string; placeholder: string; line?: boolean };
const TOOLS: Tool[] = [
  { label: "H2", title: "Заголовок розділу", before: "## ", after: "", placeholder: "Назва розділу", line: true },
  { label: "H3", title: "Підзаголовок", before: "### ", after: "", placeholder: "Назва підрозділу", line: true },
  { label: "B", title: "Жирний текст (Ctrl+B)", before: "**", after: "**", placeholder: "важливий текст" },
  { label: "I", title: "Курсив (Ctrl+I)", before: "*", after: "*", placeholder: "текст" },
  { label: "•", title: "Маркований список", before: "- ", after: "", placeholder: "Пункт списку", line: true },
  { label: "1.", title: "Нумерований список", before: "1. ", after: "", placeholder: "Пункт списку", line: true },
  { label: "❞", title: "Цитата або примітка", before: "> ", after: "", placeholder: "Примітка", line: true },
  { label: "🔗", title: "Посилання", before: "[", after: "](https://example.com)", placeholder: "Назва посилання" },
  { label: "`", title: "Код", before: "`", after: "`", placeholder: "код" },
];

export function StaticMarkdownEditor({ value, onChange, disabled }: EditorProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"edit" | "split" | "preview">("split");
  const [fileError, setFileError] = useState("");

  function insert(tool: Tool) {
    const input = inputRef.current;
    if (disabled || !input) return;
    const from = input.selectionStart;
    const to = input.selectionEnd;
    const selected = value.slice(from, to) || tool.placeholder;
    const lineStart = tool.line && from > 0 && value[from - 1] !== "\n" ? "\n" : "";
    const replacement = `${lineStart}${tool.before}${selected}${tool.after}`;
    if (value.length - (to - from) + replacement.length > 20_000) { setFileError("Максимальна довжина правил — 20 000 символів."); return; }
    onChange(value.slice(0, from) + replacement + value.slice(to));
    setView((old) => old === "preview" ? "split" : old);
    requestAnimationFrame(() => {
      input.focus();
      const caret = from + lineStart.length + tool.before.length;
      input.setSelectionRange(caret, caret + selected.length);
    });
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.ctrlKey || event.metaKey)) return;
    const target = event.key.toLowerCase();
    const tool = target === "b" ? TOOLS[2] : target === "i" ? TOOLS[3] : undefined;
    if (tool) { event.preventDefault(); insert(tool); }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || disabled) return;
    setFileError("");
    if (!/\.(md|markdown|txt)$/i.test(file.name) || file.size > 80_000) { setFileError("Потрібен файл .md або .txt розміром до 80 КБ."); return; }
    try {
      const markdown = (await file.text()).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
      if (markdown.length > 20_000) { setFileError("Текст завеликий: дозволено до 20 000 символів."); return; }
      if (!markdown.trim()) { setFileError("Файл не містить правил."); return; }
      if (value.trim() && !window.confirm("Замінити поточний текст правилами з файлу? Незбережені зміни буде втрачено.")) return;
      onChange(markdown);
      setView("split");
    } catch { setFileError("Не вдалося прочитати Markdown-файл."); }
  }

  function exportFile() {
    const data = new Blob([value], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pravila-statyka.md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return <div className={styles.mdEditor}>
    <div className={styles.mdEditorHeader}>
      <div className={styles.mdTabs} role="group" aria-label="Режим редактора">
        {(["edit", "split", "preview"] as const).map((tab) => <button type="button" className={`btn subtle ${styles.mdTab} ${view === tab ? styles.mdTabActive : ""}`} aria-pressed={view === tab} onClick={() => setView(tab)} key={tab}>{tab === "edit" ? "Markdown" : tab === "split" ? "Поруч" : "Перегляд"}</button>)}
      </div>
      <div className={styles.mdFileActions}>
        <input ref={fileRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={(event) => { void importFile(event); }} hidden aria-label="Завантажити Markdown-файл" />
        <button type="button" className="btn subtle" disabled={disabled} onClick={() => fileRef.current?.click()}>Імпорт .md</button>
        <button type="button" className="btn subtle" disabled={!value} onClick={exportFile}>Експорт .md</button>
      </div>
    </div>
    <div className={styles.mdToolbar} role="toolbar" aria-label="Форматування Markdown">
      {TOOLS.map((tool) => <button type="button" key={tool.title} className="btn subtle" title={tool.title} aria-label={tool.title} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => insert(tool)}>{tool.label}</button>)}
    </div>
    <div className={`${styles.mdWorkspace} ${view === "split" ? styles.mdSplit : ""}`}>
      <div className={`${styles.mdPane} ${view === "preview" ? styles.mdHidden : ""}`}>
        <label className={styles.mdPaneLabel} htmlFor="static-rules-markdown">Текст Markdown</label>
        <textarea ref={inputRef} id="static-rules-markdown" className={styles.editor} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} onKeyDown={onEditorKeyDown} rows={18} maxLength={20_000} spellCheck />
      </div>
      <div className={`${styles.mdPane} ${view === "edit" ? styles.mdHidden : ""}`}>
        <div className={styles.mdPaneLabel}>Як правила побачать учасники</div>
        <div className={styles.mdPreview}><StaticMarkdown value={value || "*Тут відображатиметься попередній перегляд правил.*"} /></div>
      </div>
    </div>
    {fileError ? <p className={styles.mdFileError} role="alert">{fileError}</p> : null}
    <div className={styles.mdHint}>Markdown: <code>## Заголовок</code> · <code>**жирний**</code> · <code>*курсив*</code> · <code>- список</code> · <code>&gt; цитата</code> · <code>[назва](https://…)</code>. HTML не виконується.</div>
  </div>;
}
