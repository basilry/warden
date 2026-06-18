import { readFileSync } from "node:fs";
import {
  expandDomainQuery,
  loadDomainOntology,
  loadScenarioLibrary,
  type DomainOntology,
  type DomainQueryExpansion,
  type DomainScenarioLibrary
} from "../src/domain/index.ts";

type GoldenIds = {
  actors?: string[];
  regions?: string[];
  sectors?: string[];
  signals?: string[];
  risks?: string[];
  sourceHints?: string[];
  scenarios?: string[];
};

type EvalCase = {
  caseId: string;
  domain: string;
  question: string;
  golden: GoldenIds;
};

type EvalFixture = {
  evalSetId: string;
  version: string;
  description: string;
  cases: EvalCase[];
};

const ontology = loadDomainOntology();
const scenarioLibrary = loadScenarioLibrary(undefined, ontology);

assertAtLeast(ontology.actors.length, 10, "ontology actor count");
assertAtLeast(ontology.signals.length, 10, "ontology signal count");
assertAtLeast(scenarioLibrary.templates.length, 4, "scenario template count");

const taiwanExpansion = expandDomainQuery("Taiwan semiconductor blockade", { ontology, scenarioLibrary });
assertIdsInclude(
  taiwanExpansion.actors.map((item) => item.id),
  ["pla_eastern_theater_command", "taiwan_mnd", "taiwan_coast_guard", "tsmc"],
  "Taiwan blockade actors"
);
assertIdsInclude(
  taiwanExpansion.signals.map((item) => item.id),
  ["maritime_exclusion_zone", "vessel_inspection_boarding", "shipping_insurance_premium", "semiconductor_fab_output_guidance"],
  "Taiwan blockade signals"
);
assertIdsInclude(
  taiwanExpansion.sourceHints.map((item) => item.id),
  ["taiwan_mnd_daily_activity", "ais_maritime_tracks", "port_authority_notices", "company_filings_guidance"],
  "Taiwan blockade source hints"
);
assertIdsInclude(
  taiwanExpansion.scenarios.map((item) => item.id),
  ["scenario_taiwan_strait_blockade"],
  "Taiwan blockade scenarios"
);
assertIncludes(taiwanExpansion.expandedTerms.actors.join("\n"), "Taiwan Semiconductor Manufacturing Company", "expanded actor terms");
assertIncludes(taiwanExpansion.expandedTerms.risks.join("\n"), "blockade", "expanded risk terms");
assertIncludes(taiwanExpansion.expandedTerms.sourceHints.join("\n"), "AIS maritime tracks", "expanded source hint terms");

const koreanTaiwanExpansion = expandDomainQuery("중국의 대만 침공 가능성", { ontology, scenarioLibrary });
assertIdsInclude(
  koreanTaiwanExpansion.scenarios.map((item) => item.id),
  ["scenario_taiwan_strait_blockade"],
  "Korean Taiwan invasion scenario"
);
assertIdsInclude(
  koreanTaiwanExpansion.actors.map((item) => item.id),
  ["prc_government", "pla_eastern_theater_command", "taiwan_mnd"],
  "Korean Taiwan invasion actors"
);

for (const fixturePath of [
  "../evals/security-forecast-cases.json",
  "../evals/supply-chain-cases.json",
  "../evals/geopolitics-cases.json"
]) {
  const fixture = loadEvalFixture(fixturePath);
  validateEvalFixtureIds(fixture, ontology, scenarioLibrary);
  for (const evalCase of fixture.cases) {
    const expansion = expandDomainQuery(evalCase.question, { ontology, scenarioLibrary });
    assertGoldenIncluded(expansion, evalCase.golden, `${fixture.evalSetId}/${evalCase.caseId}`);
  }
}

console.log("WARDEN domain ontology regression: passed");
console.log(renderExpansionSummary(taiwanExpansion));

function loadEvalFixture(relativePath: string): EvalFixture {
  const path = new URL(relativePath, import.meta.url).pathname;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`${relativePath} must be an object`);
  const fixture: EvalFixture = {
    evalSetId: readString(parsed.evalSetId),
    version: readString(parsed.version),
    description: readString(parsed.description),
    cases: readArray(parsed.cases).map(parseEvalCase)
  };
  if (!fixture.evalSetId) throw new Error(`${relativePath} missing evalSetId`);
  if (!fixture.version) throw new Error(`${relativePath} missing version`);
  assertAtLeast(fixture.cases.length, 3, `${relativePath} case count`);
  return fixture;
}

function parseEvalCase(value: unknown): EvalCase {
  if (!isRecord(value)) {
    return { caseId: "", domain: "", question: "", golden: {} };
  }
  return {
    caseId: readString(value.caseId),
    domain: readString(value.domain),
    question: readString(value.question),
    golden: parseGoldenIds(value.golden)
  };
}

function parseGoldenIds(value: unknown): GoldenIds {
  if (!isRecord(value)) return {};
  return {
    actors: readStringArray(value.actors),
    regions: readStringArray(value.regions),
    sectors: readStringArray(value.sectors),
    signals: readStringArray(value.signals),
    risks: readStringArray(value.risks),
    sourceHints: readStringArray(value.sourceHints),
    scenarios: readStringArray(value.scenarios)
  };
}

function validateEvalFixtureIds(fixture: EvalFixture, ontology: DomainOntology, scenarioLibrary: DomainScenarioLibrary): void {
  const validIds = {
    actors: new Set(ontology.actors.map((item) => item.id)),
    regions: new Set(ontology.regions.map((item) => item.id)),
    sectors: new Set(ontology.sectors.map((item) => item.id)),
    signals: new Set(ontology.signals.map((item) => item.id)),
    risks: new Set(ontology.risks.map((item) => item.id)),
    sourceHints: new Set(ontology.sourceHints.map((item) => item.id)),
    scenarios: new Set(scenarioLibrary.templates.map((item) => item.id))
  };

  for (const evalCase of fixture.cases) {
    if (!evalCase.caseId) throw new Error(`${fixture.evalSetId} has a case without caseId`);
    if (!evalCase.question) throw new Error(`${fixture.evalSetId}/${evalCase.caseId} missing question`);
    checkKnownIds(evalCase.golden.actors ?? [], validIds.actors, `${fixture.evalSetId}/${evalCase.caseId} actors`);
    checkKnownIds(evalCase.golden.regions ?? [], validIds.regions, `${fixture.evalSetId}/${evalCase.caseId} regions`);
    checkKnownIds(evalCase.golden.sectors ?? [], validIds.sectors, `${fixture.evalSetId}/${evalCase.caseId} sectors`);
    checkKnownIds(evalCase.golden.signals ?? [], validIds.signals, `${fixture.evalSetId}/${evalCase.caseId} signals`);
    checkKnownIds(evalCase.golden.risks ?? [], validIds.risks, `${fixture.evalSetId}/${evalCase.caseId} risks`);
    checkKnownIds(evalCase.golden.sourceHints ?? [], validIds.sourceHints, `${fixture.evalSetId}/${evalCase.caseId} sourceHints`);
    checkKnownIds(evalCase.golden.scenarios ?? [], validIds.scenarios, `${fixture.evalSetId}/${evalCase.caseId} scenarios`);
  }
}

function assertGoldenIncluded(expansion: DomainQueryExpansion, golden: GoldenIds, label: string): void {
  assertIdsInclude(expansion.actors.map((item) => item.id), golden.actors ?? [], `${label} actors`);
  assertIdsInclude(expansion.regions.map((item) => item.id), golden.regions ?? [], `${label} regions`);
  assertIdsInclude(expansion.sectors.map((item) => item.id), golden.sectors ?? [], `${label} sectors`);
  assertIdsInclude(expansion.signals.map((item) => item.id), golden.signals ?? [], `${label} signals`);
  assertIdsInclude(expansion.risks.map((item) => item.id), golden.risks ?? [], `${label} risks`);
  assertIdsInclude(expansion.sourceHints.map((item) => item.id), golden.sourceHints ?? [], `${label} sourceHints`);
  assertIdsInclude(expansion.scenarios.map((item) => item.id), golden.scenarios ?? [], `${label} scenarios`);
}

function renderExpansionSummary(expansion: DomainQueryExpansion): string {
  return [
    `Query: ${expansion.query}`,
    `Actors: ${expansion.actors.map((item) => item.id).join(", ")}`,
    `Signals: ${expansion.signals.map((item) => item.id).join(", ")}`,
    `Source hints: ${expansion.sourceHints.map((item) => item.id).join(", ")}`,
    `Scenarios: ${expansion.scenarios.map((item) => item.id).join(", ")}`
  ].join("\n");
}

function checkKnownIds(ids: string[], validIds: Set<string>, label: string): void {
  for (const id of ids) {
    if (!validIds.has(id)) throw new Error(`${label} references unknown id: ${id}`);
  }
}

function assertIdsInclude(actual: string[], expected: string[], label: string): void {
  for (const id of expected) {
    if (!actual.includes(id)) {
      throw new Error(`${label} missing ${id}; actual=${actual.join(", ")}`);
    }
  }
}

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing ${expected}\n${value}`);
  }
}

function assertAtLeast(actual: number, expected: number, label: string): void {
  if (actual < expected) {
    throw new Error(`${label} failed: expected at least ${expected}, actual=${actual}`);
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
