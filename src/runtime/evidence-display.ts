import type { Evidence, KnowledgeUnit } from "../agent/types.ts";
import { translateDisplayKo } from "./korean-format.ts";

const DEFAULT_SUMMARY_CHAR_LIMIT = 280;
const LONG_CLAIM_CHAR_THRESHOLD = 500;
const MAX_SUMMARY_CHAR_LIMIT = 500;
const MIN_SUMMARY_CHAR_LIMIT = 80;

const TRACKING_QUERY_KEYS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid"
]);

const BOILERPLATE_PATTERNS: RegExp[] = [
  /\badvertisement\b/i,
  /\bad choices\b/i,
  /\ball rights reserved\b/i,
  /\baccept cookies\b/i,
  /\bcookie(s)?\b/i,
  /\bcopyright\b/i,
  /\benable javascript\b/i,
  /\blog in\b/i,
  /\blogin\b/i,
  /\bmanage consent\b/i,
  /\bnewsletter\b/i,
  /\bprivacy policy\b/i,
  /\bread more\b/i,
  /\bshare this article\b/i,
  /\bsign up\b/i,
  /\bskip to content\b/i,
  /\bsubscribe\b/i,
  /\bterms of service\b/i,
  /구독(하기|하세요)?/i,
  /광고/i,
  /개인정보\s*처리방침/i,
  /서비스\s*약관/i,
  /쿠키\s*(정책|설정)?/i,
  /로그인/i,
  /회원가입/i,
  /뉴스레터/i,
  /본문으로\s*건너뛰기/i
];

export type EvidenceDisplayItem = Evidence | KnowledgeUnit;

export type EvidenceDisplayOptions = {
  title?: string;
  canonicalUrl?: string;
  source?: string;
  publisher?: string;
  publishedDate?: string;
  sourceKind?: string;
  summary?: string;
  maxSummaryChars?: number;
};

export type EvidenceDisplayCard = {
  id: string;
  title: string;
  canonicalUrl?: string;
  source: string;
  publisher?: string;
  domain?: string;
  publishedDate?: string;
  reliability: string;
  sourceKind: string;
  summary: string;
};

export type EvidenceDisplaySet = {
  achEvidence: Evidence[];
  domainEvidence: KnowledgeUnit[];
  fetchedEvidence: KnowledgeUnit[];
  ragEvidence?: KnowledgeUnit[];
  maxItems?: number;
  debugEvidence?: boolean;
};

export function formatEvidenceDisplay(input: EvidenceDisplaySet): string[] {
  const maxItems = input.maxItems ?? 8;
  const maxSummaryChars = input.debugEvidence ? 500 : 160;
  const cards = uniqueCards([
    ...input.fetchedEvidence.map((unit) =>
      buildEvidenceDisplayCard(unit, {
        sourceKind: "실시간 OSINT",
        maxSummaryChars
      })
    ),
    ...(input.ragEvidence ?? []).map((unit) =>
      buildEvidenceDisplayCard(unit, {
        sourceKind: "로컬 RAG",
        maxSummaryChars
      })
    ),
    ...input.domainEvidence.map((unit) =>
      buildEvidenceDisplayCard(unit, {
        sourceKind: "도메인 근거",
        maxSummaryChars
      })
    ),
    ...input.achEvidence.map((item) =>
      buildEvidenceDisplayCard(item, {
        sourceKind: "ACH",
        maxSummaryChars
      })
    )
  ]).slice(0, maxItems);
  const values = cards.map(formatEvidenceDisplayCard);
  return values.length > 0 ? values : ["아직 답변에 사용할 구조화 근거가 없습니다."];
}

export function buildEvidenceDisplayCard(item: EvidenceDisplayItem, options: EvidenceDisplayOptions = {}): EvidenceDisplayCard {
  return isKnowledgeUnit(item) ? buildKnowledgeUnitCard(item, options) : buildAchEvidenceCard(item, options);
}

export function buildEvidenceDisplayCards(
  items: EvidenceDisplayItem[],
  options: EvidenceDisplayOptions | ((item: EvidenceDisplayItem) => EvidenceDisplayOptions) = {}
): EvidenceDisplayCard[] {
  return items.map((item) => buildEvidenceDisplayCard(item, typeof options === "function" ? options(item) : options));
}

export function formatEvidenceDisplayString(item: EvidenceDisplayItem, options: EvidenceDisplayOptions = {}): string {
  return formatEvidenceDisplayCard(buildEvidenceDisplayCard(item, options));
}

export function formatEvidenceDisplayCard(card: EvidenceDisplayCard): string {
  const sourceLabel = firstString([card.publisher, card.domain, card.source]) ?? "미상";
  const summary = card.canonicalUrl ? undefined : card.summary && card.summary !== card.title ? `요약: ${card.summary}` : undefined;
  return [
    `[${card.sourceKind}]`,
    `제목: ${card.title}`,
    card.canonicalUrl ? `URL: ${card.canonicalUrl}` : `출처: ${card.source}`,
    card.publishedDate ? `게시일: ${card.publishedDate}` : undefined,
    `발행/출처: ${sourceLabel}`,
    `신뢰도: ${card.reliability}`,
    summary
  ]
    .filter((part): part is string => Boolean(part))
    .join(" | ");
}

export function summarizeEvidenceText(value: string | undefined, maxChars = DEFAULT_SUMMARY_CHAR_LIMIT): string {
  const limit = normalizeSummaryLimit(maxChars);
  const raw = normalizeText(stripHtml(value ?? ""));
  if (!raw) return "";

  const withoutBoilerplate = normalizeText(selectInformativeSegments(raw).join(" "));
  const clean = withoutBoilerplate || removeBoilerplateTerms(raw);
  const normalized = normalizeText(clean);
  if (!normalized) return "";

  if (raw.length > LONG_CLAIM_CHAR_THRESHOLD || normalized.length > limit) {
    return truncateAtWord(normalized, limit);
  }
  return normalized;
}

function buildKnowledgeUnitCard(unit: KnowledgeUnit, options: EvidenceDisplayOptions): EvidenceDisplayCard {
  const record = unit as unknown as Record<string, unknown>;
  const sourceUri = firstString([
    options.canonicalUrl,
    readMetadataString(record, ["canonicalUrl", "url", "uri"]),
    unit.sourceUri
  ]);
  const canonicalUrl = canonicalizeUrl(sourceUri);
  const domain = domainFromUrl(canonicalUrl);
  const publisher = firstString([
    options.publisher,
    readMetadataString(record, ["publisher", "sourceName", "siteName", "provider"]),
    domain
  ]);
  const source = firstString([options.source, publisher, domain, canonicalUrl, sourceLabelFromUri(unit.sourceUri), unit.id]) ?? unit.id;
  const summarySource = firstString([
    options.summary,
    readMetadataString(record, ["summary", "description", "excerpt", "textExcerpt"]),
    unit.claims[0]?.text
  ]);
  const title = firstString([
    options.title,
    readMetadataString(record, ["title", "headline", "name"]),
    titleFromSourceUri(unit.sourceUri),
    titleFromUrl(canonicalUrl),
    publisher,
    shortSourceTitle(source),
    unit.id
  ]) ?? unit.id;

  return {
    id: unit.id,
    title: cleanDisplayField(title),
    canonicalUrl,
    source: cleanDisplayField(source),
    publisher: publisher ? cleanDisplayField(publisher) : undefined,
    domain,
    publishedDate: normalizeDate(firstString([
      options.publishedDate,
      readMetadataString(record, ["publishedAt", "publishedDate", "datePublished", "publicationDate"])
    ])),
    reliability: firstString([unit.reliability, readMetadataString(record, ["reliability"])]) ?? "미상",
    sourceKind: combineSourceKind(options.sourceKind, unit.sourceType),
    summary: summarizeForDisplay(summarySource, title, options.maxSummaryChars)
  };
}

function buildAchEvidenceCard(item: Evidence, options: EvidenceDisplayOptions): EvidenceDisplayCard {
  const record = item as unknown as Record<string, unknown>;
  const sourceUri = firstString([
    options.canonicalUrl,
    readMetadataString(record, ["canonicalUrl", "url", "uri"]),
    item.source
  ]);
  const canonicalUrl = canonicalizeUrl(sourceUri);
  const domain = domainFromUrl(canonicalUrl);
  const publisher = firstString([
    options.publisher,
    readMetadataString(record, ["publisher", "sourceName", "siteName", "provider"]),
    domain
  ]);
  const source = firstString([options.source, publisher, domain, sourceLabelFromUri(item.source), canonicalUrl, item.id]) ?? item.id;
  const title = firstString([
    options.title,
    readMetadataString(record, ["title", "headline", "name"]),
    titleFromSourceUri(item.source),
    titleFromUrl(canonicalUrl),
    shortSourceTitle(item.source),
    item.id
  ]) ?? item.id;

  return {
    id: item.id,
    title: cleanDisplayField(title),
    canonicalUrl,
    source: cleanDisplayField(source),
    publisher: publisher ? cleanDisplayField(publisher) : undefined,
    domain,
    publishedDate: normalizeDate(firstString([
      options.publishedDate,
      readMetadataString(record, ["publishedAt", "publishedDate", "datePublished", "publicationDate"])
    ])),
    reliability: item.reliability || "미상",
    sourceKind: options.sourceKind ?? "ACH evidence",
    summary: summarizeForDisplay(firstString([options.summary, item.text]), title, options.maxSummaryChars)
  };
}

function summarizeForDisplay(value: string | undefined, fallback: string, maxChars: number | undefined): string {
  const translatedValue = translateDisplayKo(value);
  const summary = summarizeEvidenceText(translatedValue || value, maxChars ?? DEFAULT_SUMMARY_CHAR_LIMIT);
  return translateDisplayKo(summary || cleanDisplayField(fallback));
}

function isKnowledgeUnit(item: EvidenceDisplayItem): item is KnowledgeUnit {
  return Array.isArray((item as KnowledgeUnit).claims) && typeof (item as KnowledgeUnit).sourceUri === "string";
}

function readMetadataString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) return value;
  }

  for (const containerKey of ["metadata", "meta", "sourceMetadata"]) {
    const container = asRecord(record[containerKey]);
    if (!container) continue;
    for (const key of keys) {
      const value = readString(container[key]);
      if (value) return value;
    }
  }

  return undefined;
}

function firstString(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = readString(value);
    if (trimmed) return trimmed;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function canonicalizeUrl(value: string | undefined): string | undefined {
  const trimmed = readString(value);
  if (!trimmed) return undefined;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.startsWith("utm_") || TRACKING_QUERY_KEYS.has(normalizedKey)) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function domainFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function titleFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const slug = pathParts[pathParts.length - 1];
    const candidate = slug ? decodeURIComponent(slug).replace(/[-_]+/g, " ") : domainFromUrl(value);
    if (!candidate) return undefined;
    return cleanDisplayField(candidate);
  } catch {
    return undefined;
  }
}

function titleFromSourceUri(value: string | undefined): string | undefined {
  const label = sourceLabelFromUri(value);
  if (!label) return undefined;
  return cleanDisplayField(label.replace(/\.[a-z0-9]{2,5}$/i, ""));
}

function sourceLabelFromUri(value: string | undefined): string | undefined {
  const trimmed = readString(value);
  if (!trimmed) return undefined;

  const canonicalUrl = canonicalizeUrl(trimmed);
  if (canonicalUrl) return titleFromUrl(canonicalUrl) ?? domainFromUrl(canonicalUrl);

  const withoutFragment = trimmed.split("#")[0]?.split("?")[0] ?? trimmed;
  const pathParts = withoutFragment
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .split(/[\\/]/)
    .filter(Boolean);
  const leaf = pathParts[pathParts.length - 1] ?? withoutFragment;
  const candidate = decodeURIComponent(leaf).replace(/[-_]+/g, " ").trim();
  return candidate || undefined;
}

function shortSourceTitle(value: string | undefined): string | undefined {
  const sourceTitle = titleFromSourceUri(value);
  if (!sourceTitle) return undefined;
  return sourceTitle.length <= 96 ? sourceTitle : truncateAtWord(sourceTitle, 96);
}

function normalizeDate(value: string | undefined): string | undefined {
  const trimmed = readString(value);
  if (!trimmed) return undefined;
  const isoDate = /^\d{4}-\d{2}-\d{2}/.exec(trimmed);
  if (isoDate) return isoDate[0];

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function combineSourceKind(contextKind: string | undefined, sourceType: KnowledgeUnit["sourceType"]): string {
  const context = readString(contextKind);
  return context ? `${context}/${sourceType}` : sourceType;
}

function cleanDisplayField(value: string | undefined): string {
  const stripped = removeBoilerplateTerms(normalizeText(stripHtml(value ?? "")));
  return stripped || "미상";
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function selectInformativeSegments(value: string): string[] {
  return value
    .replace(/\r\n?/g, "\n")
    .split(/\n+|(?<=[.!?])\s+/)
    .map(normalizeText)
    .filter((segment) => segment && !isBoilerplateSegment(segment));
}

function isBoilerplateSegment(value: string): boolean {
  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(value));
}

function removeBoilerplateTerms(value: string): string {
  let clean = value;
  for (const pattern of BOILERPLATE_PATTERNS) {
    while (pattern.test(clean)) {
      clean = clean.replace(pattern, " ");
    }
  }
  return normalizeText(clean);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSummaryLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SUMMARY_CHAR_LIMIT;
  return Math.max(MIN_SUMMARY_CHAR_LIMIT, Math.min(Math.floor(value), MAX_SUMMARY_CHAR_LIMIT));
}

function truncateAtWord(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const slice = value.slice(0, maxChars + 1);
  const lastSpace = slice.lastIndexOf(" ");
  const truncated = (lastSpace >= MIN_SUMMARY_CHAR_LIMIT / 2 ? slice.slice(0, lastSpace) : slice.slice(0, maxChars)).trim();
  return `${truncated}...`;
}

function uniqueCards(cards: EvidenceDisplayCard[]): EvidenceDisplayCard[] {
  const seen = new Set<string>();
  const result: EvidenceDisplayCard[] = [];
  for (const card of cards) {
    const key = [card.canonicalUrl, card.sourceKind, card.title, card.source]
      .filter(Boolean)
      .join("|")
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(card);
  }
  return result;
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
