import { loadDomainOntology } from "./ontology.ts";
import { loadScenarioLibrary } from "./scenarios.ts";
import type {
  DomainActor,
  DomainBaseEntity,
  DomainEntityRefs,
  DomainExpandedTerms,
  DomainMatchedTerm,
  DomainOntology,
  DomainQueryExpansion,
  DomainRegion,
  DomainRisk,
  DomainScenarioLibrary,
  DomainScenarioTemplate,
  DomainSector,
  DomainSignal,
  DomainSourceHint
} from "./types.ts";

export type DomainQueryExpansionOptions = {
  ontology?: DomainOntology;
  scenarioLibrary?: DomainScenarioLibrary;
};

type ExpansionSets = {
  actorIds: Set<string>;
  regionIds: Set<string>;
  sectorIds: Set<string>;
  signalIds: Set<string>;
  riskIds: Set<string>;
  sourceHintIds: Set<string>;
  scenarioIds: Set<string>;
};

export function expandDomainQuery(query: string, options: DomainQueryExpansionOptions = {}): DomainQueryExpansion {
  const ontology = options.ontology ?? loadDomainOntology();
  const scenarioLibrary = options.scenarioLibrary ?? loadScenarioLibrary(undefined, ontology);
  const normalizedQuery = normalizeDomainText(query);
  const sets = createExpansionSets();
  const seedSets = createExpansionSets();
  const matchedTerms: DomainMatchedTerm[] = [];

  matchEntities("actor", ontology.actors, normalizedQuery, sets.actorIds, seedSets.actorIds, matchedTerms);
  matchEntities("region", ontology.regions, normalizedQuery, sets.regionIds, seedSets.regionIds, matchedTerms);
  matchEntities("sector", ontology.sectors, normalizedQuery, sets.sectorIds, seedSets.sectorIds, matchedTerms);
  matchEntities("signal", ontology.signals, normalizedQuery, sets.signalIds, seedSets.signalIds, matchedTerms);
  matchEntities("risk", ontology.risks, normalizedQuery, sets.riskIds, seedSets.riskIds, matchedTerms);
  matchEntities("source_hint", ontology.sourceHints, normalizedQuery, sets.sourceHintIds, seedSets.sourceHintIds, matchedTerms);

  expandLinkedEntities(sets, ontology);
  matchScenarios(normalizedQuery, scenarioLibrary.templates, sets, seedSets, matchedTerms);
  expandLinkedEntities(sets, ontology);

  const actors = itemsById(ontology.actors, sets.actorIds);
  const regions = itemsById(ontology.regions, sets.regionIds);
  const sectors = itemsById(ontology.sectors, sets.sectorIds);
  const signals = itemsById(ontology.signals, sets.signalIds);
  const risks = itemsById(ontology.risks, sets.riskIds);
  const sourceHints = itemsById(ontology.sourceHints, sets.sourceHintIds);
  const scenarios = itemsById(scenarioLibrary.templates, sets.scenarioIds);

  return {
    query,
    normalizedQuery,
    matchedTerms,
    actors,
    regions,
    sectors,
    signals,
    risks,
    sourceHints,
    scenarios,
    expandedTerms: buildExpandedTerms({ actors, regions, sectors, signals, risks, sourceHints, scenarios }),
    warnings: buildExpansionWarnings(query, matchedTerms, scenarios)
  };
}

export function normalizeDomainText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d"'`]/g, "")
    .replace(/[^a-z0-9가-힣_/\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchEntities<T extends DomainBaseEntity>(
  kind: DomainMatchedTerm["kind"],
  entities: T[],
  normalizedQuery: string,
  resultIds: Set<string>,
  seedIds: Set<string>,
  matchedTerms: DomainMatchedTerm[]
): void {
  for (const entity of entities) {
    const matched = firstMatchedAlias(entity, normalizedQuery);
    if (!matched) continue;
    resultIds.add(entity.id);
    seedIds.add(entity.id);
    pushMatchedTerm(matchedTerms, {
      kind,
      id: entity.id,
      label: entity.label,
      matched,
      source: "query"
    });
  }
}

function firstMatchedAlias(entity: DomainBaseEntity, normalizedQuery: string): string | undefined {
  const aliases = uniqueNonEmpty([entity.id, entity.label, ...entity.aliases]);
  for (const alias of aliases) {
    const normalizedAlias = normalizeDomainText(alias);
    if (normalizedAlias && includesTerm(normalizedQuery, normalizedAlias)) return alias;
  }
  return undefined;
}

function includesTerm(normalizedQuery: string, normalizedTerm: string): boolean {
  if (!normalizedQuery || !normalizedTerm) return false;
  if (normalizedTerm.length <= 3 && /^[a-z0-9]+$/.test(normalizedTerm)) {
    return normalizedQuery.split(" ").includes(normalizedTerm);
  }
  return normalizedQuery.includes(normalizedTerm);
}

function expandLinkedEntities(sets: ExpansionSets, ontology: DomainOntology): void {
  for (const actor of ontology.actors) {
    if (sets.actorIds.has(actor.id)) addRefs(actor, sets);
  }
  for (const region of ontology.regions) {
    if (sets.regionIds.has(region.id)) addRefs(region, sets);
  }
  for (const sector of ontology.sectors) {
    if (sets.sectorIds.has(sector.id)) addRefs(sector, sets);
  }
  for (const signal of ontology.signals) {
    if (sets.signalIds.has(signal.id)) addRefs(signal, sets);
  }
  for (const risk of ontology.risks) {
    if (sets.riskIds.has(risk.id)) addRefs(risk, sets);
  }
}

function addRefs(refs: DomainEntityRefs, sets: ExpansionSets): void {
  addIds(refs.actorIds, sets.actorIds);
  addIds(refs.regionIds, sets.regionIds);
  addIds(refs.sectorIds, sets.sectorIds);
  addIds(refs.signalIds, sets.signalIds);
  addIds(refs.riskIds, sets.riskIds);
  addIds(refs.sourceHintIds, sets.sourceHintIds);
}

function matchScenarios(
  normalizedQuery: string,
  scenarios: DomainScenarioTemplate[],
  sets: ExpansionSets,
  seedSets: ExpansionSets,
  matchedTerms: DomainMatchedTerm[]
): void {
  for (const scenario of scenarios) {
    const directTrigger = scenario.triggerTerms.find((term) => includesTerm(normalizedQuery, normalizeDomainText(term)));
    const overlap = directTrigger ? 0 : scenarioOverlap(scenario, seedSets);
    if (!directTrigger && overlap < 4) continue;

    sets.scenarioIds.add(scenario.id);
    addRefs(scenario, sets);
    pushMatchedTerm(matchedTerms, {
      kind: "scenario",
      id: scenario.id,
      label: scenario.title,
      matched: directTrigger ?? `entity-overlap:${overlap}`,
      source: "scenario"
    });
  }
}

function scenarioOverlap(scenario: DomainScenarioTemplate, seedSets: ExpansionSets): number {
  return (
    countOverlap(scenario.actorIds, seedSets.actorIds) +
    countOverlap(scenario.regionIds, seedSets.regionIds) +
    countOverlap(scenario.sectorIds, seedSets.sectorIds) +
    countOverlap(scenario.signalIds, seedSets.signalIds) +
    countOverlap(scenario.riskIds, seedSets.riskIds) +
    countOverlap(scenario.sourceHintIds, seedSets.sourceHintIds)
  );
}

function countOverlap(ids: string[], seedIds: Set<string>): number {
  return ids.filter((id) => seedIds.has(id)).length;
}

function buildExpandedTerms(input: {
  actors: DomainActor[];
  regions: DomainRegion[];
  sectors: DomainSector[];
  signals: DomainSignal[];
  risks: DomainRisk[];
  sourceHints: DomainSourceHint[];
  scenarios: DomainScenarioTemplate[];
}): DomainExpandedTerms {
  return {
    actors: termsForEntities(input.actors),
    regions: termsForEntities(input.regions),
    sectors: termsForEntities(input.sectors),
    signals: termsForEntities(input.signals),
    risks: termsForEntities(input.risks),
    sourceHints: termsForEntities(input.sourceHints),
    scenarios: uniqueNonEmpty(input.scenarios.flatMap((scenario) => [scenario.id, scenario.title, ...scenario.triggerTerms]))
  };
}

function termsForEntities(entities: DomainBaseEntity[]): string[] {
  return uniqueNonEmpty(entities.flatMap((entity) => [entity.id, entity.label, ...entity.aliases]));
}

function buildExpansionWarnings(query: string, matchedTerms: DomainMatchedTerm[], scenarios: DomainScenarioTemplate[]): string[] {
  const warnings: string[] = [];
  if (query.trim().length === 0) warnings.push("query is empty");
  if (matchedTerms.filter((term) => term.source === "query").length === 0) warnings.push("no ontology aliases matched the query");
  if (scenarios.length === 0) warnings.push("no scenario templates matched the query");
  return warnings;
}

function createExpansionSets(): ExpansionSets {
  return {
    actorIds: new Set<string>(),
    regionIds: new Set<string>(),
    sectorIds: new Set<string>(),
    signalIds: new Set<string>(),
    riskIds: new Set<string>(),
    sourceHintIds: new Set<string>(),
    scenarioIds: new Set<string>()
  };
}

function addIds(ids: string[], set: Set<string>): void {
  for (const id of ids) set.add(id);
}

function itemsById<T extends { id: string }>(items: T[], ids: Set<string>): T[] {
  return items.filter((item) => ids.has(item.id));
}

function pushMatchedTerm(terms: DomainMatchedTerm[], term: DomainMatchedTerm): void {
  if (!term.id) return;
  if (terms.some((item) => item.kind === term.kind && item.id === term.id && item.source === term.source)) return;
  terms.push(term);
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = normalizeDomainText(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
