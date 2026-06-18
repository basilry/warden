import { readFileSync } from "node:fs";
import type {
  DomainOntology,
  DomainScenarioLibrary,
  DomainScenarioTemplate,
  ScenarioHypothesis
} from "./types.ts";
import { emptyRefs } from "./ontology.ts";

const DEFAULT_SCENARIO_LIBRARY_URL = new URL("../../fixtures/domain/scenario-library.json", import.meta.url);

export function getDefaultScenarioLibraryPath(): string {
  return DEFAULT_SCENARIO_LIBRARY_URL.pathname;
}

export function loadScenarioLibrary(path = getDefaultScenarioLibraryPath(), ontology?: DomainOntology): DomainScenarioLibrary {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const library = parseScenarioLibrary(parsed);
  const warnings = validateScenarioLibrary(library, ontology);
  if (warnings.length > 0) {
    throw new Error(`Invalid scenario library: ${warnings.join("; ")}`);
  }
  return library;
}

export function validateScenarioLibrary(library: DomainScenarioLibrary, ontology?: DomainOntology): string[] {
  const warnings: string[] = [];
  if (!library.libraryId) warnings.push("libraryId is required");
  if (!library.version) warnings.push("version is required");
  if (!library.title) warnings.push("title is required");
  if (!Array.isArray(library.templates) || library.templates.length === 0) {
    warnings.push("templates is empty");
    return warnings;
  }

  const ids = new Set<string>();
  for (const template of library.templates) {
    if (!template.id) warnings.push("scenario id is required");
    if (!template.title) warnings.push(`scenario ${template.id || "(unknown)"} title is required`);
    if (ids.has(template.id)) warnings.push(`duplicate scenario id: ${template.id}`);
    ids.add(template.id);
    if (template.triggerTerms.length === 0) warnings.push(`scenario ${template.id} triggerTerms is empty`);
    if (template.hypotheses.length === 0) warnings.push(`scenario ${template.id} hypotheses is empty`);
    for (const hypothesis of template.hypotheses) {
      if (!hypothesis.id) warnings.push(`scenario ${template.id} has a hypothesis without id`);
      if (!hypothesis.statement) warnings.push(`scenario ${template.id} hypothesis ${hypothesis.id || "(unknown)"} statement is required`);
    }
  }

  if (ontology) checkOntologyRefs(library, ontology, warnings);
  return warnings;
}

function parseScenarioLibrary(value: unknown): DomainScenarioLibrary {
  if (!isRecord(value)) throw new Error("scenario library must be an object");
  return {
    libraryId: readString(value.libraryId),
    version: readString(value.version),
    title: readString(value.title),
    description: readString(value.description),
    templates: readArray(value.templates).map(parseScenarioTemplate)
  };
}

function parseScenarioTemplate(value: unknown): DomainScenarioTemplate {
  const refs = emptyRefs();
  if (!isRecord(value)) {
    return {
      ...refs,
      id: "",
      title: "",
      summary: "",
      domainTags: [],
      triggerTerms: [],
      hypotheses: [],
      analystPrompts: []
    };
  }
  return {
    ...refs,
    actorIds: readStringArray(value.actorIds),
    regionIds: readStringArray(value.regionIds),
    sectorIds: readStringArray(value.sectorIds),
    signalIds: readStringArray(value.signalIds),
    riskIds: readStringArray(value.riskIds),
    sourceHintIds: readStringArray(value.sourceHintIds),
    id: readString(value.id),
    title: readString(value.title),
    summary: readString(value.summary),
    domainTags: readStringArray(value.domainTags),
    triggerTerms: readStringArray(value.triggerTerms),
    hypotheses: readArray(value.hypotheses).map(parseHypothesis),
    analystPrompts: readStringArray(value.analystPrompts)
  };
}

function parseHypothesis(value: unknown): ScenarioHypothesis {
  if (!isRecord(value)) {
    return { id: "", title: "", statement: "", indicatorSignalIds: [], disconfirmingSignalIds: [] };
  }
  return {
    id: readString(value.id),
    title: readString(value.title),
    statement: readString(value.statement),
    indicatorSignalIds: readStringArray(value.indicatorSignalIds),
    disconfirmingSignalIds: readStringArray(value.disconfirmingSignalIds)
  };
}

function checkOntologyRefs(library: DomainScenarioLibrary, ontology: DomainOntology, warnings: string[]): void {
  const actorIds = new Set(ontology.actors.map((item) => item.id));
  const regionIds = new Set(ontology.regions.map((item) => item.id));
  const sectorIds = new Set(ontology.sectors.map((item) => item.id));
  const signalIds = new Set(ontology.signals.map((item) => item.id));
  const riskIds = new Set(ontology.risks.map((item) => item.id));
  const sourceHintIds = new Set(ontology.sourceHints.map((item) => item.id));

  for (const template of library.templates) {
    checkList(`scenario ${template.id}`, "actorIds", template.actorIds, actorIds, warnings);
    checkList(`scenario ${template.id}`, "regionIds", template.regionIds, regionIds, warnings);
    checkList(`scenario ${template.id}`, "sectorIds", template.sectorIds, sectorIds, warnings);
    checkList(`scenario ${template.id}`, "signalIds", template.signalIds, signalIds, warnings);
    checkList(`scenario ${template.id}`, "riskIds", template.riskIds, riskIds, warnings);
    checkList(`scenario ${template.id}`, "sourceHintIds", template.sourceHintIds, sourceHintIds, warnings);
    for (const hypothesis of template.hypotheses) {
      checkList(`scenario ${template.id} hypothesis ${hypothesis.id}`, "indicatorSignalIds", hypothesis.indicatorSignalIds, signalIds, warnings);
      checkList(`scenario ${template.id} hypothesis ${hypothesis.id}`, "disconfirmingSignalIds", hypothesis.disconfirmingSignalIds, signalIds, warnings);
    }
  }
}

function checkList(label: string, field: string, ids: string[], validIds: Set<string>, warnings: string[]): void {
  for (const id of ids) {
    if (!validIds.has(id)) warnings.push(`${label} ${field} references unknown id: ${id}`);
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

