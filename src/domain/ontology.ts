import { readFileSync } from "node:fs";
import type {
  DomainActor,
  DomainBaseEntity,
  DomainEntityRefs,
  DomainOntology,
  DomainRegion,
  DomainRisk,
  DomainSector,
  DomainSignal,
  DomainSourceHint
} from "./types.ts";

const DEFAULT_ONTOLOGY_URL = new URL("../../fixtures/domain/security-ontology.json", import.meta.url);

export function getDefaultDomainOntologyPath(): string {
  return DEFAULT_ONTOLOGY_URL.pathname;
}

export function loadDomainOntology(path = getDefaultDomainOntologyPath()): DomainOntology {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const ontology = parseDomainOntology(parsed);
  const warnings = validateDomainOntology(ontology);
  if (warnings.length > 0) {
    throw new Error(`Invalid domain ontology: ${warnings.join("; ")}`);
  }
  return ontology;
}

export function validateDomainOntology(ontology: DomainOntology): string[] {
  const warnings: string[] = [];
  if (!ontology.ontologyId) warnings.push("ontologyId is required");
  if (!ontology.version) warnings.push("version is required");
  if (!ontology.title) warnings.push("title is required");
  if (!Array.isArray(ontology.limits) || ontology.limits.length === 0) warnings.push("limits is empty");

  validateCollection("actor", ontology.actors, warnings);
  validateCollection("region", ontology.regions, warnings);
  validateCollection("sector", ontology.sectors, warnings);
  validateCollection("signal", ontology.signals, warnings);
  validateCollection("risk", ontology.risks, warnings);
  validateCollection("sourceHint", ontology.sourceHints, warnings);

  const actorIds = new Set(ontology.actors.map((item) => item.id));
  const regionIds = new Set(ontology.regions.map((item) => item.id));
  const sectorIds = new Set(ontology.sectors.map((item) => item.id));
  const signalIds = new Set(ontology.signals.map((item) => item.id));
  const riskIds = new Set(ontology.risks.map((item) => item.id));
  const sourceHintIds = new Set(ontology.sourceHints.map((item) => item.id));

  for (const actor of ontology.actors) checkRefs(`actor ${actor.id}`, actor, warnings, actorIds, regionIds, sectorIds, signalIds, riskIds, sourceHintIds);
  for (const region of ontology.regions) checkRefs(`region ${region.id}`, region, warnings, actorIds, regionIds, sectorIds, signalIds, riskIds, sourceHintIds);
  for (const sector of ontology.sectors) checkRefs(`sector ${sector.id}`, sector, warnings, actorIds, regionIds, sectorIds, signalIds, riskIds, sourceHintIds);
  for (const signal of ontology.signals) checkRefs(`signal ${signal.id}`, signal, warnings, actorIds, regionIds, sectorIds, signalIds, riskIds, sourceHintIds);
  for (const risk of ontology.risks) checkRefs(`risk ${risk.id}`, risk, warnings, actorIds, regionIds, sectorIds, signalIds, riskIds, sourceHintIds);

  return warnings;
}

function parseDomainOntology(value: unknown): DomainOntology {
  if (!isRecord(value)) throw new Error("ontology must be an object");
  return {
    ontologyId: readString(value.ontologyId),
    version: readString(value.version),
    title: readString(value.title),
    description: readString(value.description),
    limits: readStringArray(value.limits),
    actors: readArray(value.actors).map(parseActor),
    regions: readArray(value.regions).map(parseRegion),
    sectors: readArray(value.sectors).map(parseSector),
    signals: readArray(value.signals).map(parseSignal),
    risks: readArray(value.risks).map(parseRisk),
    sourceHints: readArray(value.sourceHints).map(parseSourceHint)
  };
}

function parseActor(value: unknown): DomainActor {
  const base = parseBaseEntity(value);
  const refs = parseRefs(value);
  return {
    ...base,
    ...refs,
    category: isRecord(value) ? readString(value.category) : ""
  };
}

function parseRegion(value: unknown): DomainRegion {
  const base = parseBaseEntity(value);
  const refs = parseRefs(value);
  return {
    ...base,
    ...refs,
    parentId: isRecord(value) ? readString(value.parentId) : ""
  };
}

function parseSector(value: unknown): DomainSector {
  return {
    ...parseBaseEntity(value),
    ...parseRefs(value)
  };
}

function parseSignal(value: unknown): DomainSignal {
  return {
    ...parseBaseEntity(value),
    ...parseRefs(value),
    polarity: parseSignalPolarity(isRecord(value) ? value.polarity : undefined)
  };
}

function parseRisk(value: unknown): DomainRisk {
  return {
    ...parseBaseEntity(value),
    ...parseRefs(value)
  };
}

function parseSourceHint(value: unknown): DomainSourceHint {
  return {
    ...parseBaseEntity(value),
    sourceType: parseSourceType(isRecord(value) ? value.sourceType : undefined),
    reliabilityNote: isRecord(value) ? readString(value.reliabilityNote) : ""
  };
}

function parseBaseEntity(value: unknown): DomainBaseEntity {
  if (!isRecord(value)) {
    return { id: "", label: "", aliases: [], tags: [], description: "" };
  }
  return {
    id: readString(value.id),
    label: readString(value.label),
    aliases: readStringArray(value.aliases),
    tags: readStringArray(value.tags),
    description: readString(value.description)
  };
}

function parseRefs(value: unknown): DomainEntityRefs {
  if (!isRecord(value)) return emptyRefs();
  return {
    actorIds: readStringArray(value.actorIds),
    regionIds: readStringArray(value.regionIds),
    sectorIds: readStringArray(value.sectorIds),
    signalIds: readStringArray(value.signalIds),
    riskIds: readStringArray(value.riskIds),
    sourceHintIds: readStringArray(value.sourceHintIds)
  };
}

export function emptyRefs(): DomainEntityRefs {
  return {
    actorIds: [],
    regionIds: [],
    sectorIds: [],
    signalIds: [],
    riskIds: [],
    sourceHintIds: []
  };
}

function validateCollection(kind: string, items: DomainBaseEntity[], warnings: string[]): void {
  if (!Array.isArray(items) || items.length === 0) {
    warnings.push(`${kind} collection is empty`);
    return;
  }
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id) warnings.push(`${kind} id is required`);
    if (!item.label) warnings.push(`${kind} ${item.id || "(unknown)"} label is required`);
    if (ids.has(item.id)) warnings.push(`duplicate ${kind} id: ${item.id}`);
    ids.add(item.id);
  }
}

function checkRefs(
  label: string,
  refs: DomainEntityRefs,
  warnings: string[],
  actorIds: Set<string>,
  regionIds: Set<string>,
  sectorIds: Set<string>,
  signalIds: Set<string>,
  riskIds: Set<string>,
  sourceHintIds: Set<string>
): void {
  checkRefList(label, "actorIds", refs.actorIds, actorIds, warnings);
  checkRefList(label, "regionIds", refs.regionIds, regionIds, warnings);
  checkRefList(label, "sectorIds", refs.sectorIds, sectorIds, warnings);
  checkRefList(label, "signalIds", refs.signalIds, signalIds, warnings);
  checkRefList(label, "riskIds", refs.riskIds, riskIds, warnings);
  checkRefList(label, "sourceHintIds", refs.sourceHintIds, sourceHintIds, warnings);
}

function checkRefList(label: string, field: string, ids: string[], validIds: Set<string>, warnings: string[]): void {
  for (const id of ids) {
    if (!validIds.has(id)) warnings.push(`${label} ${field} references unknown id: ${id}`);
  }
}

function parseSignalPolarity(value: unknown): DomainSignal["polarity"] {
  if (value === "warning" || value === "stabilizing" || value === "context" || value === "unknown") return value;
  return "unknown";
}

function parseSourceType(value: unknown): DomainSourceHint["sourceType"] {
  if (
    value === "official" ||
    value === "trade_data" ||
    value === "maritime" ||
    value === "corporate" ||
    value === "media" ||
    value === "research" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
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

