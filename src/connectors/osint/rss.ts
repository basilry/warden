export type ParsedRssItem = {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
};

export function parseRssItems(xml: string): ParsedRssItem[] {
  const items: ParsedRssItem[] = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = extractTag(itemXml, "title");
    const link = extractTag(itemXml, "link");
    const description = extractTag(itemXml, "description");
    const pubDate = extractTag(itemXml, "pubDate");
    if (title) {
      items.push({ title, link: link || "", description: description || title, pubDate });
    }
  }

  if (items.length > 0) return items;

  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  while ((match = entryRegex.exec(xml)) !== null) {
    const entryXml = match[1];
    const title = extractTag(entryXml, "title");
    const linkMatch = entryXml.match(/<link[^>]*href=["']([^"']*)["'][^>]*\/?>/);
    const link = linkMatch?.[1] || extractTag(entryXml, "link") || "";
    const summary = extractTag(entryXml, "summary") || extractTag(entryXml, "content") || title || "";
    const updated = extractTag(entryXml, "updated") || extractTag(entryXml, "published");
    if (title) {
      items.push({ title, link, description: summary, pubDate: updated });
    }
  }

  return items;
}

function extractTag(xml: string, tag: string): string | undefined {
  const regex = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`, "i");
  const match = xml.match(regex);
  if (!match) return undefined;
  const value = decodeXmlEntities((match[1] || match[2] || "").replace(/<[^>]*>/g, " ").trim());
  return value.replace(/\s+/g, " ").trim() || undefined;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}
