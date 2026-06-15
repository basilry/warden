import { readFileSync } from "node:fs";
import type { KnowledgeUnit } from "../types.ts";

export type SupplyChainProfileScope = {
  regions: string[];
  sectors: string[];
  limits: string[];
};

export type SupplyChainProfileClaim = {
  id: string;
  text: string;
  reliability: string;
  tags: string[];
};

export type SupplyChainProfileSection = {
  id: string;
  title: string;
  summary: string;
  claims: SupplyChainProfileClaim[];
};

export type SupplyChainAnswerFrame = {
  id: string;
  intent: string;
  outline: string[];
};

export type SupplyChainDomainProfile = {
  profileId: string;
  version: string;
  title: string;
  scope: SupplyChainProfileScope;
  sections: SupplyChainProfileSection[];
  answerFrames: SupplyChainAnswerFrame[];
};

const DEFAULT_PROFILE_URL = new URL(
  "../../../fixtures/domain/korea-northeast-asia-supply-chain.json",
  import.meta.url
);

export function getDefaultSupplyChainProfilePath(): string {
  return DEFAULT_PROFILE_URL.pathname;
}

export function loadKoreaNortheastAsiaSupplyChainProfile(path = getDefaultSupplyChainProfilePath()): SupplyChainDomainProfile {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const profile = parseSupplyChainDomainProfile(parsed);
  const warnings = validateSupplyChainDomainProfile(profile);
  if (warnings.length > 0) {
    throw new Error(`Invalid supply-chain profile: ${warnings.join("; ")}`);
  }
  return profile;
}

export function validateSupplyChainDomainProfile(profile: SupplyChainDomainProfile): string[] {
  const warnings: string[] = [];
  if (!profile.profileId) warnings.push("profileId is required");
  if (!profile.version) warnings.push("version is required");
  if (!profile.title) warnings.push("title is required");
  if (!Array.isArray(profile.scope.regions) || profile.scope.regions.length === 0) warnings.push("scope.regions is empty");
  if (!Array.isArray(profile.scope.sectors) || profile.scope.sectors.length === 0) warnings.push("scope.sectors is empty");
  if (!Array.isArray(profile.scope.limits) || profile.scope.limits.length === 0) warnings.push("scope.limits is empty");
  if (!Array.isArray(profile.sections) || profile.sections.length === 0) warnings.push("sections is empty");

  const claimIds = new Set<string>();
  for (const section of profile.sections) {
    if (!section.id) warnings.push("section.id is required");
    if (!section.title) warnings.push(`section ${section.id || "(unknown)"} title is required`);
    if (!section.summary) warnings.push(`section ${section.id || "(unknown)"} summary is required`);
    if (!Array.isArray(section.claims) || section.claims.length === 0) {
      warnings.push(`section ${section.id || "(unknown)"} claims is empty`);
      continue;
    }
    for (const claim of section.claims) {
      if (!claim.id) warnings.push(`section ${section.id} has a claim without id`);
      if (claimIds.has(claim.id)) warnings.push(`duplicate claim id: ${claim.id}`);
      claimIds.add(claim.id);
      if (!claim.text) warnings.push(`claim ${claim.id} text is required`);
      if (!claim.reliability) warnings.push(`claim ${claim.id} reliability is required`);
      if (!claim.tags.includes("domain:defense_supply_chain")) {
        warnings.push(`claim ${claim.id} missing domain:defense_supply_chain tag`);
      }
      if (!claim.tags.includes("topic:supply_chain")) {
        warnings.push(`claim ${claim.id} missing topic:supply_chain tag`);
      }
    }
  }
  return warnings;
}

export function buildSupplyChainKnowledgeUnits(
  profile = loadKoreaNortheastAsiaSupplyChainProfile()
): KnowledgeUnit[] {
  return profile.sections.flatMap((section) =>
    section.claims.map((claim): KnowledgeUnit => {
      const sourceUri = `fixture://${profile.profileId}/${section.id}/${claim.id}`;
      return {
        id: `ku_${claim.id}`,
        sourceUri,
        sourceType: "fixture",
        extractedAt: `${profile.version}T00:00:00.000Z`,
        claims: [
          {
            id: claim.id,
            text: claim.text,
            confidence: reliabilityToConfidence(claim.reliability),
            evidenceRefs: [`profile:${profile.profileId}`, `section:${section.id}`]
          }
        ],
        provenance: {
          capturedBy: "agent",
          originalLocation: sourceUri,
          contentHash: stableClaimHash(profile.profileId, section.id, claim.id),
          parserVersion: `p10-supply-chain-profile-${profile.version}`
        },
        reliability: claim.reliability,
        tags: uniqueNonEmpty([...claim.tags, `profile:${profile.profileId}`, `section:${section.id}`])
      };
    })
  );
}

export function selectSupplyChainProfileSections(profile: SupplyChainDomainProfile, tags: string[]): SupplyChainProfileSection[] {
  if (tags.length === 0) return profile.sections;
  const tagSet = new Set(tags);
  return profile.sections.filter((section) =>
    section.claims.some((claim) => claim.tags.some((tag) => tagSet.has(tag)))
  );
}

export function summarizeSupplyChainProfile(profile = loadKoreaNortheastAsiaSupplyChainProfile()): string {
  return [
    `${profile.title} (${profile.profileId}, ${profile.version})`,
    `Regions: ${profile.scope.regions.join(", ")}`,
    `Sectors: ${profile.scope.sectors.join(", ")}`,
    `Sections: ${profile.sections.map((section) => section.id).join(", ")}`,
    `Limits: ${profile.scope.limits.join(" ")}`
  ].join("\n");
}

export function findSupplyChainAnswerFrame(profile: SupplyChainDomainProfile, intent: string): SupplyChainAnswerFrame | undefined {
  return profile.answerFrames.find((frame) => frame.intent === intent);
}

function parseSupplyChainDomainProfile(value: unknown): SupplyChainDomainProfile {
  if (!isRecord(value)) throw new Error("profile must be an object");
  return {
    profileId: readString(value.profileId),
    version: readString(value.version),
    title: readString(value.title),
    scope: parseScope(value.scope),
    sections: readArray(value.sections).map(parseSection),
    answerFrames: readArray(value.answerFrames).map(parseAnswerFrame)
  };
}

function parseScope(value: unknown): SupplyChainProfileScope {
  if (!isRecord(value)) {
    return { regions: [], sectors: [], limits: [] };
  }
  return {
    regions: readStringArray(value.regions),
    sectors: readStringArray(value.sectors),
    limits: readStringArray(value.limits)
  };
}

function parseSection(value: unknown): SupplyChainProfileSection {
  if (!isRecord(value)) {
    return { id: "", title: "", summary: "", claims: [] };
  }
  return {
    id: readString(value.id),
    title: readString(value.title),
    summary: readString(value.summary),
    claims: readArray(value.claims).map(parseClaim)
  };
}

function parseClaim(value: unknown): SupplyChainProfileClaim {
  if (!isRecord(value)) {
    return { id: "", text: "", reliability: "", tags: [] };
  }
  return {
    id: readString(value.id),
    text: readString(value.text),
    reliability: readString(value.reliability),
    tags: readStringArray(value.tags)
  };
}

function parseAnswerFrame(value: unknown): SupplyChainAnswerFrame {
  if (!isRecord(value)) {
    return { id: "", intent: "", outline: [] };
  }
  return {
    id: readString(value.id),
    intent: readString(value.intent),
    outline: readStringArray(value.outline)
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function reliabilityToConfidence(reliability: string): number {
  const letter = reliability[0] ?? "C";
  const number = Number(reliability[1] ?? "3");
  const letterScore = letter === "A" ? 0.88 : letter === "B" ? 0.74 : letter === "C" ? 0.62 : 0.5;
  const numberPenalty = Number.isFinite(number) ? Math.max(0, number - 1) * 0.04 : 0.08;
  return Number(Math.max(0.35, letterScore - numberPenalty).toFixed(2));
}

function stableClaimHash(profileId: string, sectionId: string, claimId: string): string {
  const input = `${profileId}:${sectionId}:${claimId}`;
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return `p10_${hash.toString(16).padStart(8, "0")}`;
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
