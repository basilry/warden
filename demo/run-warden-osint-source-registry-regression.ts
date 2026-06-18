import type { OsintFetchLike } from "../src/connectors/osint/http-client.ts";
import { extractArticleFromHtml } from "../src/connectors/osint/article-extractor.ts";
import { checkRobotsAllowed, fetchRobotsPolicy } from "../src/connectors/osint/robots.ts";
import { fetchSitemapUrls } from "../src/connectors/osint/sitemap.ts";
import {
  assertSourceRegistryUrlAllowed,
  loadOsintSourceRegistry,
  selectRegisteredSources
} from "../src/connectors/osint/source-registry.ts";

const registry = loadOsintSourceRegistry();
const kinds = [...new Set(selectRegisteredSources(registry).map((source) => source.kind))].sort();
assertEqual(kinds.join(","), "market,news,official,think_tank", "source registry kinds");
assertEqual(selectRegisteredSources(registry, { kinds: ["official"] }).length >= 6, true, "expanded official source registry");

const allowed = assertSourceRegistryUrlAllowed(
  "https://www.defense.gov/News/Releases/Release/Article/3820000/example/#section",
  registry,
  { kinds: ["official"] }
);
assertEqual(allowed.source.id, "us-defense-news", "official source match");
assertEqual(
  allowed.url.toString(),
  "https://www.defense.gov/News/Releases/Release/Article/3820000/example/",
  "source URL canonicalization"
);

assertThrowsIncludes(
  () => assertSourceRegistryUrlAllowed("https://www.defense.gov/Images/hidden.jpg", registry, { kinds: ["official"] }),
  "blocked non-allowed URL",
  "source registry path guard"
);
assertThrowsIncludes(
  () => assertSourceRegistryUrlAllowed("https://example.test/News/Releases/example", registry),
  "blocked non-allowed URL",
  "source registry domain guard"
);

const fetchedUrls: string[] = [];
const fetchImpl: OsintFetchLike = async (url) => {
  fetchedUrls.push(url);
  const parsed = new URL(url);
  if (parsed.pathname === "/robots.txt") {
    return {
      ok: true,
      status: 200,
      text: async () => [
        "User-agent: *",
        "Disallow: /News/private/",
        "Allow: /News/private/summary.html",
        "Sitemap: https://www.defense.gov/sitemap.xml"
      ].join("\n")
    };
  }
  if (parsed.pathname === "/sitemap.xml") {
    return {
      ok: true,
      status: 200,
      text: async () => `
        <?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url><loc>https://www.defense.gov/News/Releases/Release/Article/3820000/example/#fragment</loc></url>
          <url><loc>https://www.defense.gov/News/Releases/Release/Article/3820000/example/</loc></url>
          <url><loc>https://www.defense.gov/Images/not-allowed.jpg</loc></url>
          <url><loc>https://example.test/News/Releases/not-allowed/</loc></url>
        </urlset>
      `
    };
  }
  throw new Error(`Unexpected fetch URL: ${url}`);
};

const robots = await fetchRobotsPolicy("https://www.defense.gov/News/", {
  fetchImpl,
  userAgent: "warden-osint-regression/1.0",
  timeoutMs: 50
});
assertEqual(robots.robotsUrl, "https://www.defense.gov/robots.txt", "robots URL");
assertEqual(robots.policy.sitemaps[0], "https://www.defense.gov/sitemap.xml", "robots sitemap extraction");

const blockedByRobots = checkRobotsAllowed(
  "https://www.defense.gov/News/private/raw.html",
  robots.policy,
  "warden-osint-regression/1.0"
);
assertEqual(blockedByRobots.allowed, false, "robots disallow respected");
assertEqual(blockedByRobots.matchedRule?.directive, "disallow", "robots disallow directive");

const allowedByRobots = checkRobotsAllowed(
  "https://www.defense.gov/News/private/summary.html",
  robots.policy,
  "warden-osint-regression/1.0"
);
assertEqual(allowedByRobots.allowed, true, "robots allow override respected");

const sitemap = await fetchSitemapUrls("https://www.defense.gov/sitemap.xml", {
  fetchImpl,
  allowedDomains: ["www.defense.gov"],
  allowedPaths: ["/News/"],
  maxUrls: 10,
  timeoutMs: 50,
  userAgent: "warden-osint-regression/1.0"
});
assertEqual(sitemap.urls.length, 1, "sitemap extracted canonical URL count");
assertEqual(
  sitemap.urls[0],
  "https://www.defense.gov/News/Releases/Release/Article/3820000/example/",
  "sitemap URL canonicalization"
);

const article = extractArticleFromHtml(
  `
    <!doctype html>
    <html>
      <head>
        <title>Defense &amp; Markets Brief</title>
        <link rel="canonical" href="/News/Releases/Release/Article/3820000/example/#canonical-fragment" />
      </head>
      <body>
        <nav>Navigation text should not appear.</nav>
        <article>
          <h1>Defense &amp; Markets Brief</h1>
          <p>Analysts highlighted munitions production, shipping constraints, and semiconductor equipment risk.</p>
          <script>window.secret = "ignore";</script>
        </article>
      </body>
    </html>
  `,
  {
    requestedUrl: "https://www.defense.gov/News/Releases/Release/Article/3820000/example/?utm=fixture#top",
    maxChars: 120
  }
);
assertEqual(article.title, "Defense & Markets Brief", "article title extraction");
assertEqual(
  article.canonicalUrl,
  "https://www.defense.gov/News/Releases/Release/Article/3820000/example/",
  "article canonical extraction"
);
assertIncludes(article.textSnippet, "munitions production", "article text snippet");
assertNotIncludes(article.textSnippet, "Navigation text", "article noise removal");

assertEqual(fetchedUrls.join(","), "https://www.defense.gov/robots.txt,https://www.defense.gov/sitemap.xml", "mocked fetch URLs");

console.log("WARDEN OSINT source registry regression: passed");

function assertThrowsIncludes(fn: () => unknown, expected: string, label: string): void {
  try {
    fn();
  } catch (error) {
    assertIncludes((error as Error).message, expected, label);
    return;
  }
  throw new Error(`${label}: expected throw`);
}

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}

function assertNotIncludes(value: string, expected: string, label: string): void {
  if (value.includes(expected)) {
    throw new Error(`${label} included unexpected output: ${expected}\n${value}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}
