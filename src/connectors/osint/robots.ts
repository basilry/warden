import type { OsintFetchLike, OsintHttpResponse } from "./http-client.ts";

export type RobotsDirective = "allow" | "disallow";

export type RobotsRule = {
  directive: RobotsDirective;
  path: string;
  line: number;
};

export type RobotsGroup = {
  agents: string[];
  rules: RobotsRule[];
};

export type RobotsPolicy = {
  groups: RobotsGroup[];
  sitemaps: string[];
};

export type RobotsCheckResult = {
  allowed: boolean;
  url: string;
  userAgent: string;
  matchedRule?: RobotsRule;
  reason: string;
};

export type FetchRobotsOptions = {
  fetchImpl?: OsintFetchLike;
  userAgent?: string;
  timeoutMs?: number;
  robotsUrl?: string;
};

export type FetchedRobotsPolicy = {
  robotsUrl: string;
  status: number;
  text: string;
  policy: RobotsPolicy;
};

const DEFAULT_USER_AGENT = "warden-osint/1.0";

export function parseRobotsTxt(text: string): RobotsPolicy {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let currentGroup: RobotsGroup | undefined;
  let currentGroupHasRules = false;

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = stripRobotsComment(lines[index]).trim();
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }

    if (field === "user-agent") {
      const agent = value.toLowerCase();
      if (!agent) continue;
      if (!currentGroup || currentGroupHasRules) {
        currentGroup = { agents: [], rules: [] };
        groups.push(currentGroup);
        currentGroupHasRules = false;
      }
      currentGroup.agents.push(agent);
      continue;
    }

    if (field !== "allow" && field !== "disallow") continue;
    if (!currentGroup) continue;

    currentGroup.rules.push({
      directive: field,
      path: value,
      line: lineNumber
    });
    currentGroupHasRules = true;
  }

  return {
    groups: groups.filter((group) => group.agents.length > 0),
    sitemaps: [...new Set(sitemaps)]
  };
}

export function checkRobotsAllowed(
  targetUrl: string,
  policy: RobotsPolicy,
  userAgent = DEFAULT_USER_AGENT
): RobotsCheckResult {
  const url = normalizeRobotsTargetUrl(targetUrl);
  const rules = selectRobotsRules(policy, userAgent);
  const targetPath = `${url.pathname}${url.search}`;
  const matchedRule = chooseMostSpecificRule(
    rules.filter((rule) => ruleMatchesTarget(rule, targetPath))
  );

  if (!matchedRule) {
    return {
      allowed: true,
      url: url.toString(),
      userAgent,
      reason: "No matching robots rule."
    };
  }

  return {
    allowed: matchedRule.directive === "allow",
    url: url.toString(),
    userAgent,
    matchedRule,
    reason: `Matched ${matchedRule.directive} rule on line ${matchedRule.line}: ${matchedRule.path || "(empty)"}`
  };
}

export function isRobotsAllowed(targetUrl: string, policy: RobotsPolicy, userAgent = DEFAULT_USER_AGENT): boolean {
  return checkRobotsAllowed(targetUrl, policy, userAgent).allowed;
}

export async function fetchRobotsPolicy(siteUrl: string, options: FetchRobotsOptions = {}): Promise<FetchedRobotsPolicy> {
  const robotsUrl = options.robotsUrl ? normalizeRobotsTargetUrl(options.robotsUrl) : robotsUrlForSite(siteUrl);
  const fetchImpl = options.fetchImpl ?? getGlobalFetch();
  if (!fetchImpl) {
    throw new Error("No fetch implementation is available for OSINT robots.txt.");
  }

  const response = await fetchText(robotsUrl.toString(), fetchImpl, {
    accept: "text/plain, */*",
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    timeoutMs: options.timeoutMs,
    label: "OSINT robots.txt"
  });

  if (response.status === 404) {
    return { robotsUrl: robotsUrl.toString(), status: response.status, text: "", policy: parseRobotsTxt("") };
  }
  if (!response.ok) {
    throw new Error(`OSINT robots.txt returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`);
  }

  const text = await readTextResponse(response, "OSINT robots.txt");
  return { robotsUrl: robotsUrl.toString(), status: response.status, text, policy: parseRobotsTxt(text) };
}

function selectRobotsRules(policy: RobotsPolicy, userAgent: string): RobotsRule[] {
  const agent = userAgent.toLowerCase();
  let bestSpecificity = -1;
  const matchingGroups: RobotsGroup[] = [];

  for (const group of policy.groups) {
    const specificity = bestAgentSpecificity(group.agents, agent);
    if (specificity < 0) continue;
    if (specificity > bestSpecificity) {
      bestSpecificity = specificity;
      matchingGroups.length = 0;
    }
    if (specificity === bestSpecificity) matchingGroups.push(group);
  }

  return matchingGroups.flatMap((group) => group.rules);
}

function bestAgentSpecificity(agents: string[], userAgent: string): number {
  let best = -1;
  for (const agent of agents) {
    if (agent === "*") {
      best = Math.max(best, 0);
      continue;
    }
    if (userAgent.includes(agent)) {
      best = Math.max(best, agent.length);
    }
  }
  return best;
}

function chooseMostSpecificRule(rules: RobotsRule[]): RobotsRule | undefined {
  let selected: RobotsRule | undefined;
  let selectedLength = -1;
  for (const rule of rules) {
    const length = ruleSpecificity(rule.path);
    if (!selected || length > selectedLength || length === selectedLength && rule.directive === "allow") {
      selected = rule;
      selectedLength = length;
    }
  }
  return selected;
}

function ruleMatchesTarget(rule: RobotsRule, targetPath: string): boolean {
  if (rule.directive === "disallow" && rule.path === "") return false;
  return robotsPatternToRegExp(rule.path).test(targetPath);
}

function robotsPatternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}${anchored ? "$" : ""}`);
}

function ruleSpecificity(path: string): number {
  return path.replace(/[*$]/g, "").length;
}

function robotsUrlForSite(siteUrl: string): URL {
  const url = normalizeRobotsTargetUrl(siteUrl);
  return new URL("/robots.txt", url.origin);
}

function normalizeRobotsTargetUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`OSINT robots URL must use http or https: ${value}`);
  }
  if (url.username || url.password) {
    throw new Error("OSINT robots URL must not include credentials.");
  }
  url.hash = "";
  return url;
}

function stripRobotsComment(line: string): string {
  const index = line.indexOf("#");
  return index >= 0 ? line.slice(0, index) : line;
}

async function fetchText(
  url: string,
  fetchImpl: OsintFetchLike,
  options: { accept: string; userAgent: string; timeoutMs?: number; label: string }
): Promise<OsintHttpResponse> {
  if (options.timeoutMs === undefined) {
    return fetchImpl(url, {
      method: "GET",
      headers: {
        accept: options.accept,
        "user-agent": options.userAgent
      }
    });
  }

  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error(`${options.label} timeoutMs must be a positive integer.`);
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error(`${options.label} timed out after ${options.timeoutMs}ms.`));
      }, options.timeoutMs);
    });
    return await Promise.race([
      fetchImpl(url, {
        method: "GET",
        headers: {
          accept: options.accept,
          "user-agent": options.userAgent
        },
        signal: controller.signal
      }),
      timeoutPromise
    ]);
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`${options.label} timed out after ${options.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readTextResponse(response: OsintHttpResponse, label: string): Promise<string> {
  if (response.text) return response.text();
  if (response.json) return JSON.stringify(await response.json());
  throw new Error(`${label} response did not expose text() or json().`);
}

function getGlobalFetch(): OsintFetchLike | undefined {
  if (typeof globalThis.fetch !== "function") return undefined;
  return globalThis.fetch as unknown as OsintFetchLike;
}
