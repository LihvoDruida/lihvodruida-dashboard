import type { ReactNode } from "react";
import AuthorSuggestionChips from "@/components/AuthorSuggestionChips";
import ContentImageField from "@/components/ContentImageField";
import DashboardIdentity from "@/components/DashboardIdentity";
import HeroSidePanel from "@/components/HeroSidePanel";
import { getSession } from "@/lib/auth";
import { getOwnProfilePath, type AuthorNameSuggestion } from "@/lib/profiles";
import { resolveAuthorIdentity } from "@/lib/authorIdentity";
import { canManageSiteContent } from "@/lib/permissions";
import { listSiteContent, type SiteContentItem } from "@/lib/content";
import { redirect } from "next/navigation";
import { buildPageMetadata } from "@/lib/seo";

export const metadata = buildPageMetadata({
  title: "Матеріали сайту",
  description: "Створення й редагування новин та гайдів Mistblossom Vanguard для основного сайту в зручному й чистому форматі.",
  path: "/content",
  keywords: ["новини гільдії", "гайди WoW", "редактор сайту"],
});

export const dynamic = "force-dynamic";
export const revalidate = 0;
function sitePreviewBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_BASE_URL ||
    process.env.SITE_BASE_URL ||
    "https://lihvodruida.pp.ua"
  ).replace(/\/+$/, "");
}

function publicAssetUrl(path?: string) {
  const value = String(path || "").trim();
  if (!value) return "";
  if (/^(https?:)?\/\//i.test(value) || value.startsWith("data:") || value.startsWith("blob:")) return value;
  return `${sitePreviewBaseUrl()}/${value.replace(/^\/+/, "")}`;
}

function contentPublicHref(item: SiteContentItem) {
  const collection = item.kind === "news" ? "news" : "guides";
  const slug = item.slug || item.name.replace(/^(\d{4}-\d{2}-\d{2})-/, "").replace(/\.md$/i, "");
  return `${sitePreviewBaseUrl()}/${collection}/${slug}/`;
}


function contentTypeLabel(kind: SiteContentItem["kind"]) {
  return kind === "news" ? "Новина" : "Гайд";
}

function editHref(path: string) {
  return `/content?edit=${encodeURIComponent(path)}`;
}

function EditorHeader({
  mode,
  title,
  eyebrow,
  meta,
}: {
  mode: "create" | "edit";
  title: string;
  eyebrow: string;
  meta?: string;
}) {
  return (
    <div className="content-editor-head">
      <div className="content-editor-title">
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {meta ? <small>{meta}</small> : null}
      </div>
      <a className="btn subtle content-back-btn" href="/content">
        {mode === "create" ? "Скасувати" : "До списку"}
      </a>
    </div>
  );
}

function FormSection({
  title,
  hint,
  children,
  body,
}: {
  title: string;
  hint: string;
  children: ReactNode;
  body?: boolean;
}) {
  return (
    <div className={`content-form-section${body ? " content-form-section--body" : ""}`}>
      <div className="content-form-section-head">
        <strong>{title}</strong>
        <small>{hint}</small>
      </div>
      {children}
    </div>
  );
}

function CreateContentForm({ author, authorSuggestions }: { author: string; authorSuggestions: AuthorNameSuggestion[] }) {
  return (
    <section className="panel content-editor-panel content-editor-panel--modern" aria-label="Створення матеріалу">
      <EditorHeader mode="create" eyebrow="Створення" title="Новий матеріал" />

      <form className="content-form content-form--modern" method="post" action="/api/content/create" encType="multipart/form-data">
        <FormSection title="Основне" hint="Тип матеріалу, заголовок, адреса сторінки й короткий опис.">
          <div className="form-row two">
            <label className="content-field">
              <span>Тип матеріалу</span>
              <select className="select modern-select" name="kind" defaultValue="news" required>
                <option value="news">Новина</option>
                <option value="guides">Гайд</option>
              </select>
            </label>
            <label className="content-field">
              <span>Адреса сторінки</span>
              <input className="input" name="slug" placeholder="згенерується автоматично" />
            </label>
          </div>

          <label className="content-field content-field--wide">
            <span>Заголовок</span>
            <input className="input" name="title" placeholder="Наприклад: Новий рейдовий розклад" minLength={3} required />
          </label>

          <label className="content-field content-field--wide">
            <span>Короткий опис</span>
            <textarea className="input textarea compact" name="description" placeholder="Короткий опис для картки та сторінки матеріалу" minLength={12} required />
          </label>
        </FormSection>

        <FormSection title="Таксономія і медіа" hint="Категорії, теги, автор і обкладинка матеріалу.">
          <div className="form-row two">
            <label className="content-field">
              <span>Категорії</span>
              <input className="input" name="categories" placeholder="WoW Midnight, Рейд" />
            </label>
            <label className="content-field">
              <span>Теги</span>
              <input className="input" name="tags" placeholder="Mistblossom, Raid, Guide" />
            </label>
          </div>

          <div className="content-media-layout">
            <label className="content-field content-author-field">
              <span>Автор</span>
              <input id="content-author-create" className="input" name="author" defaultValue={author} />
              <AuthorSuggestionChips targetId="content-author-create" suggestions={authorSuggestions} />
              <small>За замовчуванням береться імʼя з профілю. Можна швидко підставити серверне Discord-імʼя, Discord-імʼя або імʼя з сайту.</small>
            </label>
            <ContentImageField label="Обкладинка" hint="JPG, PNG, WEBP або GIF до 8 MB" previewBaseUrl={sitePreviewBaseUrl()} />
          </div>
        </FormSection>

        <FormSection title="Markdown" hint="Основний текст матеріалу. Підтримуються заголовки, таблиці, посилання і HTML-вставки." body>
          <label className="content-field content-field--wide">
            <span>Текст Markdown</span>
            <textarea className="input textarea markdown-area" name="body" placeholder="## Вступ&#10;&#10;Основний текст матеріалу..." minLength={20} required />
          </label>

          <div className="content-actions-row content-actions-row--sticky">
            <a className="btn subtle" href="/content">Скасувати</a>
            <button className="btn primary" type="submit">Опублікувати</button>
          </div>
        </FormSection>
      </form>
    </section>
  );
}

function EditContentForm({ item, author, authorSuggestions }: { item: SiteContentItem; author: string; authorSuggestions: AuthorNameSuggestion[] }) {
  return (
    <section className="panel content-editor-panel content-editor-panel--modern" aria-label={`Редагування: ${item.title}`}>
      <EditorHeader mode="edit" eyebrow={`Редагування • ${contentTypeLabel(item.kind)}`} title={item.title} meta={item.path} />

      <form className="content-form content-form--modern" method="post" action="/api/content/update" encType="multipart/form-data">
        <input type="hidden" name="path" value={item.path} />

        <FormSection title="Основне" hint="Тип, дати, заголовок, slug і опис сторінки.">
          <div className="form-row three">
            <label className="content-field">
              <span>Тип</span>
              <select className="select modern-select" name="kind" defaultValue={item.kind} required>
                <option value="news">Новина</option>
                <option value="guides">Гайд</option>
              </select>
            </label>
            <label className="content-field">
              <span>Дата</span>
              <input className="input" type="date" name="date" defaultValue={item.date} required />
            </label>
            <label className="content-field">
              <span>Оновлено</span>
              <input className="input" type="date" name="lastModifiedAt" defaultValue={new Date().toISOString().slice(0, 10)} required />
            </label>
          </div>

          <div className="form-row two">
            <label className="content-field">
              <span>Заголовок</span>
              <input className="input" name="title" defaultValue={item.title} minLength={3} required />
            </label>
            <label className="content-field">
              <span>Адреса сторінки</span>
              <input className="input" name="slug" defaultValue={item.slug} required />
            </label>
          </div>

          <label className="content-field content-field--wide">
            <span>Опис</span>
            <textarea className="input textarea compact" name="description" defaultValue={item.description} minLength={12} required />
          </label>
        </FormSection>

        <FormSection title="Таксономія і медіа" hint="Категорії, теги, автор і попередній перегляд обкладинки.">
          <div className="form-row two">
            <label className="content-field">
              <span>Категорії</span>
              <input className="input" name="categories" defaultValue={item.categories} />
            </label>
            <label className="content-field">
              <span>Теги</span>
              <input className="input" name="tags" defaultValue={item.tags} />
            </label>
          </div>

          <div className="content-media-layout">
            <label className="content-field content-author-field">
              <span>Автор</span>
              <input id="content-author-edit" className="input" name="author" defaultValue={item.author || author} />
              <AuthorSuggestionChips targetId="content-author-edit" suggestions={authorSuggestions} />
              <small>Можна швидко підставити серверне Discord-імʼя, Discord-імʼя або імʼя з сайту.</small>
            </label>
            <div className="content-cover-stack">
              <ContentImageField label="Обкладинка" hint="Нова картинка замінить поточний шлях" currentImage={item.image} previewBaseUrl={sitePreviewBaseUrl()} />
              <label className="inline-check inline-check--card content-remove-cover">
                <input type="checkbox" name="removeImage" value="1" />
                <span>Прибрати обкладинку і показати стандартне зображення</span>
              </label>
            </div>
          </div>
        </FormSection>

        <FormSection title="Markdown" hint="Повний текст матеріалу. Зміни збережуться для сторінки сайту." body>
          <label className="content-field content-field--wide">
            <span>Markdown</span>
            <textarea className="input textarea markdown-area" name="body" defaultValue={item.body} minLength={20} required />
          </label>

          <div className="content-actions-row content-actions-row--sticky">
            <a className="btn subtle" href="/content">Скасувати</a>
            <button className="btn primary" type="submit">Зберегти зміни</button>
          </div>
        </FormSection>
      </form>

      <form className="content-delete-form content-delete-form--standalone" method="post" action="/api/content/delete">
        <input type="hidden" name="path" value={item.path} />
        <div>
          <strong>Небезпечна дія</strong>
          <small>Видаляє матеріал зі списку. Обкладинка лишається, щоб не зламати інші сторінки.</small>
        </div>
        <button className="btn danger" type="submit">Видалити матеріал</button>
      </form>
    </section>
  );
}

function ContentLibraryGroup({
  title,
  description,
  items,
  selectedPath,
}: {
  title: string;
  description: string;
  items: SiteContentItem[];
  selectedPath?: string;
}) {
  return (
    <section className="content-library-group" aria-label={title}>
      <div className="content-library-group-head">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="content-count-pill">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <p className="content-empty content-empty--compact">Поки що немає матеріалів у цьому розділі.</p>
      ) : (
        <div className="content-table dashboard-list" role="list">
          {items.map((item) => {
            const active = selectedPath === item.path;
            return (
              <article className={`content-row dashboard-list-row${active ? " is-active" : ""}`} key={item.path} role="listitem">
                <a className="content-row-main" href={editHref(item.path)} aria-current={active ? "page" : undefined}>
                  <span className="content-row-thumb" aria-hidden="true">
                    {item.image ? <img src={publicAssetUrl(item.image)} alt="" /> : <span>{contentTypeLabel(item.kind).slice(0, 1)}</span>}
                  </span>
                  <span className="content-row-title">
                    <strong>{item.title}</strong>
                    <small>{item.path}</small>
                  </span>
                  <span className="content-row-meta">
                    <time dateTime={item.date}>{item.date || "Без дати"}</time>
                    <small>{item.author || "Без автора"}</small>
                  </span>
                </a>

                <div className="content-row-actions dashboard-list-actions">
                  <a className="btn subtle" href={contentPublicHref(item)} target="_blank" rel="noreferrer">Превʼю</a>
                  <form method="post" action="/api/content/delete">
                    <input type="hidden" name="path" value={item.path} />
                    <button className="btn danger" type="submit">Видалити</button>
                  </form>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default async function ContentPage({
  searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await getSession();
  if (!user) { redirect("/login"); throw new Error("Login required"); }
  if (!canManageSiteContent(user)) redirect(await getOwnProfilePath(user));

  const params = await searchParams;
  const authorIdentity = await resolveAuthorIdentity(user);
  const authorName = authorIdentity.primaryName;
  const authorSuggestions = authorIdentity.suggestions;
  const items = await listSiteContent();
  const newsItems = items.filter((item) => item.kind === "news");
  const guideItems = items.filter((item) => item.kind === "guides");
  const selectedItem = params.edit ? items.find((item) => item.path === params.edit) : undefined;
  const isCreateMode = params.new === "1" || params.action === "new";
  const showEditor = isCreateMode || selectedItem;
  const heroMode = isCreateMode ? "create" : selectedItem ? "edit" : "library";
  const heroTitle = isCreateMode ? "Новий матеріал" : selectedItem ? "Редагування матеріалу" : "Матеріали сайту";
  const heroEyebrow = isCreateMode
    ? "Mistblossom Vanguard • Редактор матеріалів"
    : selectedItem
      ? `Mistblossom Vanguard • ${contentTypeLabel(selectedItem.kind)}`
      : "Mistblossom Vanguard • Матеріали сайту";
  const heroLead = isCreateMode
    ? "Заповни основні дані, додай обкладинку й підготуй Markdown для публікації на основному сайті."
    : selectedItem
      ? "Оновлюй заголовок, опис, категорії, теги, обкладинку та текст без зайвих переходів."
      : "Керуй новинами й гайдами для основного сайту: створюй, редагуй, переглядай і прибирай матеріали з однієї панелі.";
  const heroNote = isCreateMode
    ? "Автор автоматично береться з профілю. За потреби його можна замінити одним кліком."
    : selectedItem
      ? `${contentTypeLabel(selectedItem.kind)} • ${selectedItem.date || "без дати"} • ${selectedItem.author || "без автора"}`
      : "Новини та гайди розділені для зручності.";
  const heroPath = selectedItem?.path || (isCreateMode ? "Новий матеріал" : `${items.length} матеріалів у бібліотеці`);

  return (
    <main className="container">
      <section className="dashboard-shell content-shell" aria-label="Публікація матеріалів Mistblossom Vanguard">
        <DashboardIdentity user={user} activeSection="content" />
        <header className={`hero panel dashboard-hero content-dashboard-hero content-dashboard-hero--${heroMode}`}>
          <div className="hero-copy dashboard-hero__copy content-dashboard-hero__copy">
            <div className="eyebrow">{heroEyebrow}</div>
            <div className="content-hero-status-row" aria-label="Стан редактора">
              <span className={`content-mode-pill content-mode-pill--${heroMode}`}>
                {isCreateMode ? "Створення" : selectedItem ? contentTypeLabel(selectedItem.kind) : "Бібліотека"}
              </span>
              <span className="content-hero-path">{heroPath}</span>
            </div>
            <h1>{heroTitle}</h1>
            <span className="hero-accent" aria-hidden="true" />
            <p className="lead">{heroLead}</p>
            <div className="hero-secure-note content-hero-actions">
              <span className="hero-lock" aria-hidden="true">✦</span>
              <span>{heroNote}</span>
              <div className="content-hero-buttons">
                {!showEditor ? <a className="btn primary content-add-btn" href="/content?new=1">Додати матеріал</a> : null}
                {showEditor ? <a className="btn subtle content-add-btn" href="/content">До списку</a> : null}
                {selectedItem ? <a className="btn ghost content-add-btn" href={contentPublicHref(selectedItem)} target="_blank" rel="noreferrer">Превʼю</a> : null}
              </div>
            </div>
          </div>

          <HeroSidePanel
            ariaLabel="Огляд матеріалів сайту"
            summary={[
              { label: "РЕЖИМ", value: isCreateMode ? "Створення" : selectedItem ? "Редагування" : "Бібліотека", note: heroPath },
              { label: "АВТОР", value: authorName, note: selectedItem?.date || "Поточний профіль" },
            ]}
            stats={[
              { label: "УСЬОГО", value: items.length.toLocaleString("uk-UA") },
              { label: "НОВИН", value: newsItems.length.toLocaleString("uk-UA") },
              { label: "ГАЙДІВ", value: guideItems.length.toLocaleString("uk-UA") },
            ]}
          />
        </header>
      {params.published ? <div className="notice panel success">Опубліковано матеріал: <strong>{params.published}</strong></div> : null}
      {params.updated ? <div className="notice panel success">Оновлено матеріал: <strong>{params.updated}</strong></div> : null}
      {params.deleted ? <div className="notice panel success">Видалено матеріал: <strong>{params.deleted}</strong></div> : null}
      {params.error ? <div className="notice panel error-note">{params.error}</div> : null}
      {params.edit && !selectedItem ? <div className="notice panel error-note">Матеріал не знайдено: <strong>{params.edit}</strong></div> : null}

      <section className="content-page-stack">
          {showEditor ? (
            isCreateMode ? <CreateContentForm author={authorName} authorSuggestions={authorSuggestions} /> : selectedItem ? <EditContentForm item={selectedItem} author={authorName} authorSuggestions={authorSuggestions} /> : null
          ) : null}

          {!showEditor ? (
            <section className="content-list panel content-list--page dashboard-list-panel" aria-label="Список матеріалів сайту">
              <div className="content-section-head content-section-head--toolbar dashboard-list-head">
                <div>
                  <span className="eyebrow">Бібліотека матеріалів</span>
                  <h2>Список матеріалів</h2>
                </div>
                <div className="content-toolbar-actions">
                  <small>{items.length} матеріалів</small>
                </div>
              </div>
  
              {items.length === 0 ? (
                <p className="content-empty">Матеріали не знайдено.</p>
              ) : (
                <div className="content-library-split">
                  <ContentLibraryGroup
                    title="Новини"
                    description="Новини для головної стрічки сайту."
                    items={newsItems}
                    selectedPath={params.edit}
                  />
                  <ContentLibraryGroup
                    title="Гайди"
                    description="Гайди: рейди, класи, довідники та сезонні матеріали."
                    items={guideItems}
                    selectedPath={params.edit}
                  />
                </div>
              )}
            </section>
          ) : null}
        </section>
      </section>
    </main>
  );
}
