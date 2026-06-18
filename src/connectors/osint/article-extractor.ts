export type ArticleExtractionOptions = {
  requestedUrl?: string;
  maxChars?: number;
};

export type ExtractedArticle = {
  requestedUrl?: string;
  canonicalUrl?: string;
  title?: string;
  textSnippet: string;
  truncated: boolean;
};

const DEFAULT_MAX_CHARS = 1200;

export function extractArticleFromHtml(html: string, options: ArticleExtractionOptions = {}): ExtractedArticle {
  if (typeof html !== "string") {
    throw new Error("OSINT article extractor requires HTML as a string.");
  }
  const maxChars = normalizeMaxChars(options.maxChars);
  const requestedUrl = options.requestedUrl ? normalizeHttpUrl(options.requestedUrl) : undefined;
  const canonicalUrl = extractCanonicalUrl(html, requestedUrl);
  const title = extractTitle(html);
  const readableText = extractReadableText(html);
  const fallbackText = title ?? canonicalUrl ?? requestedUrl ?? "";
  const text = readableText || fallbackText;

  return {
    requestedUrl,
    canonicalUrl,
    title,
    textSnippet: truncate(text, maxChars),
    truncated: text.length > maxChars
  };
}

function extractTitle(html: string): string | undefined {
  const metaTitle = extractMetaContent(html, ["og:title", "twitter:title"]);
  if (metaTitle) return metaTitle;

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? normalizeText(decodeHtmlEntities(stripTags(titleMatch[1]))) : undefined;
  if (title) return title;

  const h1Match = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const h1 = h1Match ? normalizeText(decodeHtmlEntities(stripTags(h1Match[1]))) : undefined;
  return h1 || undefined;
}

function extractCanonicalUrl(html: string, requestedUrl: string | undefined): string | undefined {
  const linkPattern = /<link\b[^>]*>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const tag = match[0];
    const rel = readAttribute(tag, "rel")?.toLowerCase();
    if (!rel?.split(/\s+/).includes("canonical")) continue;
    const href = readAttribute(tag, "href");
    const normalized = href ? normalizeHttpUrl(href, requestedUrl) : undefined;
    if (normalized) return normalized;
  }

  const ogUrl = extractMetaContent(html, ["og:url", "twitter:url"]);
  const normalizedOgUrl = ogUrl ? normalizeHttpUrl(ogUrl, requestedUrl) : undefined;
  return normalizedOgUrl ?? requestedUrl;
}

function extractReadableText(html: string): string {
  const candidate =
    firstTagContent(html, "article") ??
    firstTagContent(html, "main") ??
    firstTagContent(html, "body") ??
    html;
  const withoutNoise = candidate
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form\b[\s\S]*?<\/form>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|article|section|tr)>/gi, "\n");
  return normalizeText(decodeHtmlEntities(stripTags(withoutNoise)));
}

function firstTagContent(html: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(html);
  return match?.[1];
}

function extractMetaContent(html: string, names: string[]): string | undefined {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const metaPattern = /<meta\b[^>]*>/gi;
  for (const match of html.matchAll(metaPattern)) {
    const tag = match[0];
    const key = readAttribute(tag, "property") ?? readAttribute(tag, "name");
    if (!key || !wanted.has(key.toLowerCase())) continue;
    const content = readAttribute(tag, "content");
    const normalized = content ? normalizeText(decodeHtmlEntities(content)) : undefined;
    if (normalized) return normalized;
  }
  return undefined;
}

function normalizeHttpUrl(value: string, baseUrl?: string): string | undefined {
  try {
    const url = new URL(value.trim(), baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function readAttribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value ? decodeHtmlEntities(value.trim()) : undefined;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "...",
    lt: "<",
    mdash: "-",
    nbsp: " ",
    ndash: "-",
    quot: "\""
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => safeCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => named[name.toLowerCase()] ?? entity);
}

function safeCodePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? value.slice(0, maxChars).trim() : value;
}

function normalizeMaxChars(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_CHARS;
  if (!Number.isInteger(value) || value < 1 || value > 50000) {
    throw new Error("OSINT article extractor maxChars must be an integer from 1 to 50000.");
  }
  return value;
}
