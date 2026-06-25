import { githubFetch } from "@/lib/github";
import type { DashboardSession } from "@/lib/auth";
import { canManageSiteContent } from "@/lib/permissions";
import { mapConcurrent } from "@/lib/concurrency";

export type ContentKind = "news" | "guides";

export type CreateContentInput = {
  kind: ContentKind;
  title: string;
  description: string;
  body: string;
  categories: string;
  tags: string;
  slug?: string;
  image?: File | null;
  author: string;
  user: DashboardSession;
};

export type UpdateContentInput = CreateContentInput & {
  path: string;
  date?: string;
  lastModifiedAt?: string;
  existingImage?: string;
  removeImage?: boolean;
};

export type SiteContentItem = {
  kind: ContentKind;
  path: string;
  sha?: string;
  name: string;
  title: string;
  slug: string;
  description: string;
  date: string;
  last_modified_at: string;
  author: string;
  categories: string;
  tags: string;
  image: string;
  body: string;
};

const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function isContentKind(value: string): value is ContentKind {
  return value === "news" || value === "guides";
}

export function isManagedContentPath(path: string) {
  const value = String(path || "").trim();
  if (!value.endsWith(".md")) return false;
  if (value.includes("..") || value.includes("\\")) return false;
  return value.startsWith("_news/") || value.startsWith("_guides/");
}

function assertSafeMarkdown(value: string) {
  const text = String(value || "").toLowerCase();
  if (/<\s*script\b/.test(text)) {
    throw new Error("Markdown не може містити <script>.");
  }
  if (/javascript\s*:/i.test(value)) {
    throw new Error("Markdown не може містити javascript: посилання.");
  }
  if (/<\s*iframe\b/i.test(value)) {
    throw new Error("Markdown не може містити iframe.");
  }
}

export function slugify(value: string) {
  const translit: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia",
  };

  return String(value || "")
    .trim()
    .toLowerCase()
    .split("")
    .map((char) => translit[char] ?? char)
    .join("")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function yamlScalar(value: string) {
  return JSON.stringify(String(value || "").replace(/\r\n/g, "\n"));
}

function yamlList(value: string, fallback: string) {
  const items = listFromCsv(value);
  const normalized = items.length ? items : [fallback];
  return `[${normalized.map(yamlScalar).join(", ")}]`;
}

function listFromCsv(value: string) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeMarkdown(value: string) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function normalizeAuthor(value: string, user: DashboardSession) {
  return String(value || user.name || user.login || "Mistblossom Admin").trim();
}

function normalizeDate(value: string | undefined, fallback = new Date().toISOString().slice(0, 10)) {
  const date = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : fallback;
}

function normalizeSafeImagePath(value: string) {
  const image = String(value || "").trim().replace(/\s+/g, "").slice(0, 260);
  if (!image) return "";
  if (image === "/assets/img/news-placeholder.webp") return image;

  const cleanPath = (() => {
    if (image.startsWith("/assets/img-content/")) return image;
    if (/^https:\/\/lihvodruida\.pp\.ua\/assets\/img-content\//i.test(image)) {
      try {
        return new URL(image).pathname;
      } catch {
        return "";
      }
    }
    return "";
  })();

  if (!cleanPath || cleanPath.includes("..") || cleanPath.includes("\\")) return "";
  return /^\/assets\/img-content\/[A-Za-z0-9._/-]+$/i.test(cleanPath) ? cleanPath : "";
}

function githubBranch() {
  return process.env.GITHUB_CONTENT_BRANCH || process.env.GITHUB_BRANCH || "main";
}

function toBase64(content: string | Buffer) {
  return Buffer.isBuffer(content) ? content.toString("base64") : Buffer.from(content, "utf8").toString("base64");
}

function fromBase64(content: string) {
  return Buffer.from(String(content || ""), "base64").toString("utf8");
}

async function getExistingSha(path: string): Promise<string | undefined> {
  try {
    const data = await githubFetch(`/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(githubBranch())}`);
    return typeof data?.sha === "string" ? data.sha : undefined;
  } catch (error) {
    const message = String((error as Error)?.message || error || "").toLowerCase();
    if (message.includes("not found")) return undefined;
    throw error;
  }
}

function encodeURIComponentPath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function putRepoFile(path: string, content: string | Buffer, message: string) {
  const sha = await getExistingSha(path);
  return githubFetch(`/contents/${encodeURIComponentPath(path)}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: toBase64(content),
      branch: githubBranch(),
      ...(sha ? { sha } : {}),
    }),
  });
}

export async function deleteRepoFile(path: string, message: string) {
  const sha = await getExistingSha(path);
  if (!sha) throw new Error("Файл не знайдено або вже видалено.");

  return githubFetch(`/contents/${encodeURIComponentPath(path)}`, {
    method: "DELETE",
    body: JSON.stringify({
      message,
      sha,
      branch: githubBranch(),
    }),
  });
}

async function saveImage(slug: string, file: File | null | undefined, message: string) {
  if (!file || file.size <= 0) return null;

  const ext = ALLOWED_IMAGE_TYPES[file.type];
  if (!ext) throw new Error("Підтримуються лише JPG, PNG, WEBP або GIF.");
  if (file.size > MAX_IMAGE_SIZE) throw new Error("Картинка завелика. Максимум 8 MB.");

  const buffer = Buffer.from(await file.arrayBuffer());
  const imagePath = `assets/img-content/${slug}.${ext}`;
  await putRepoFile(imagePath, buffer, message);
  return `/${imagePath}`;
}

function collectionForKind(kind: ContentKind) {
  return kind === "news" ? "_news" : "_guides";
}

function layoutForKind(kind: ContentKind) {
  return kind === "news" ? "news" : "guides";
}

function fallbackCategoryForKind(kind: ContentKind) {
  return kind === "news" ? "новини" : "гайди";
}

function buildFrontmatter(input: {
  kind: ContentKind;
  title: string;
  slug: string;
  description: string;
  date: string;
  lastModifiedAt: string;
  author: string;
  categories: string;
  tags: string;
  imagePath: string;
}) {
  const fallbackCategory = fallbackCategoryForKind(input.kind);

  return [
    "---",
    `layout: ${layoutForKind(input.kind)}`,
    `title: ${yamlScalar(input.title)}`,
    `slug: ${input.slug}`,
    `description: ${yamlScalar(input.description)}`,
    `date: ${input.date}`,
    `last_modified_at: ${input.lastModifiedAt}`,
    `author: ${yamlScalar(input.author)}`,
    `categories: ${yamlList(input.categories, fallbackCategory)}`,
    `tags: ${yamlList(input.tags, fallbackCategory)}`,
    input.imagePath ? `image: ${input.imagePath}` : "image: /assets/img/news-placeholder.webp",
    "---",
    "",
  ].join("\n");
}

function validateContentInput(input: CreateContentInput, slug: string, body: string) {
  if (!canManageSiteContent(input.user)) throw new Error("Недостатньо прав для керування новинами та гайдами.");
  if (!isContentKind(input.kind)) throw new Error("Невідомий тип матеріалу.");
  if (input.title.trim().length < 3) throw new Error("Заголовок занадто короткий.");
  if (input.description.trim().length < 12) throw new Error("Опис занадто короткий.");
  if (body.length < 20) throw new Error("Текст матеріалу занадто короткий.");
  assertSafeMarkdown(body);
  if (!slug) throw new Error("Не вдалося створити slug.");
}

export async function createSiteContent(input: CreateContentInput) {
  const title = input.title.trim();
  const description = input.description.trim();
  const body = normalizeMarkdown(input.body);
  const slug = slugify(input.slug || title);
  const author = normalizeAuthor(input.author, input.user);
  const today = new Date().toISOString().slice(0, 10);

  validateContentInput(input, slug, body);

  const message = `content: publish ${input.kind === "news" ? "news" : "guide"} ${slug}`;
  const imagePath = await saveImage(slug, input.image, message);
  const contentPath = `${collectionForKind(input.kind)}/${today}-${slug}.md`;

  const frontmatter = buildFrontmatter({
    kind: input.kind,
    title,
    slug,
    description,
    date: today,
    lastModifiedAt: today,
    author,
    categories: input.categories,
    tags: input.tags,
    imagePath: imagePath || "/assets/img/news-placeholder.webp",
  });

  await putRepoFile(contentPath, `${frontmatter}${body}\n`, message);

  return { ok: true, slug, path: contentPath, image: imagePath };
}

export async function updateSiteContent(input: UpdateContentInput) {
  const title = input.title.trim();
  const description = input.description.trim();
  const body = normalizeMarkdown(input.body);
  const slug = slugify(input.slug || title);
  const author = normalizeAuthor(input.author, input.user);
  const date = normalizeDate(input.date);
  const lastModifiedAt = normalizeDate(input.lastModifiedAt, new Date().toISOString().slice(0, 10));

  validateContentInput(input, slug, body);
  if (!isManagedContentPath(input.path)) throw new Error("Невірний шлях матеріалу.");

  const message = `content: update ${input.kind === "news" ? "news" : "guide"} ${slug}`;
  const uploadedImagePath = await saveImage(slug, input.image, message);
  const imagePath = input.removeImage
    ? "/assets/img/news-placeholder.webp"
    : uploadedImagePath || normalizeSafeImagePath(input.existingImage || "") || "/assets/img/news-placeholder.webp";
  const nextPath = `${collectionForKind(input.kind)}/${date}-${slug}.md`;

  const frontmatter = buildFrontmatter({
    kind: input.kind,
    title,
    slug,
    description,
    date,
    lastModifiedAt,
    author,
    categories: input.categories,
    tags: input.tags,
    imagePath,
  });

  await putRepoFile(nextPath, `${frontmatter}${body}\n`, message);

  if (nextPath !== input.path) {
    await deleteRepoFile(input.path, `content: remove old path for ${slug}`);
  }

  return { ok: true, slug, path: nextPath, image: imagePath };
}

function parseYamlValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const normalized = trimmed.replace(/'/g, '"');
      const parsed = JSON.parse(normalized);
      return Array.isArray(parsed) ? parsed.join(", ") : String(parsed || "");
    } catch {
      return trimmed.slice(1, -1).split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean).join(", ");
    }
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

function parseMarkdownContent(kind: ContentKind, path: string, sha: string | undefined, raw: string): SiteContentItem {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const frontmatter = match?.[1] || "";
  const body = (match?.[2] || raw).trim();
  const meta: Record<string, string> = {};

  for (const line of frontmatter.split("\n")) {
    const divider = line.indexOf(":");
    if (divider <= 0) continue;
    const key = line.slice(0, divider).trim();
    const value = line.slice(divider + 1).trim();
    meta[key] = parseYamlValue(value);
  }

  const name = path.split("/").pop() || path;
  const inferredDate = name.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1] || "";
  const inferredSlug = name.replace(/^(\d{4}-\d{2}-\d{2})-/, "").replace(/\.md$/i, "");

  return {
    kind,
    path,
    sha,
    name,
    title: meta.title || inferredSlug,
    slug: meta.slug || inferredSlug,
    description: meta.description || "",
    date: meta.date || inferredDate,
    last_modified_at: meta.last_modified_at || meta.date || inferredDate,
    author: meta.author || "",
    categories: meta.categories || "",
    tags: meta.tags || "",
    image: meta.image || "",
    body,
  };
}

async function readRepoFile(path: string) {
  const data = await githubFetch(`/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(githubBranch())}`);
  const rawContent = typeof data?.content === "string" ? data.content.replace(/\n/g, "") : "";
  return {
    sha: typeof data?.sha === "string" ? data.sha : undefined,
    content: fromBase64(rawContent),
  };
}

async function listCollection(kind: ContentKind) {
  const collection = collectionForKind(kind);
  const data = await githubFetch(`/contents/${encodeURIComponent(collection)}?ref=${encodeURIComponent(githubBranch())}`);
  const files = Array.isArray(data) ? data : [];
  const markdownFiles = files
    .filter((item) => item?.type === "file" && typeof item?.path === "string" && item.path.endsWith(".md"))
    .slice(0, 40);

  const { results } = await mapConcurrent(
    markdownFiles,
    async (file) => {
      const { sha, content } = await readRepoFile(file.path);
      return parseMarkdownContent(kind, file.path, sha, content);
    },
    {
      profile: "external-api",
      envKey: "CONTENT_READ_CONCURRENCY",
      maxEnvKey: "CONTENT_READ_MAX_CONCURRENCY",
      min: 2,
      max: 12,
      failFast: false,
    },
  );

  return results.filter(Boolean);
}

export async function listSiteContent() {
  const [news, guides] = await Promise.all([
    listCollection("news").catch(() => []),
    listCollection("guides").catch(() => []),
  ]);

  return [...news, ...guides].sort((a, b) => String(b.date || b.name).localeCompare(String(a.date || a.name)));
}
