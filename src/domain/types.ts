export type DomainEntityKind = "actor" | "region" | "sector" | "signal" | "risk" | "source_hint";

export type DomainEntityRefs = {
  actorIds: string[];
  regionIds: string[];
  sectorIds: string[];
  signalIds: string[];
  riskIds: string[];
  sourceHintIds: string[];
};

export type DomainBaseEntity = {
  id: string;
  label: string;
  aliases: string[];
  tags: string[];
  description: string;
};

export type DomainActor = DomainBaseEntity &
  DomainEntityRefs & {
    category: string;
  };

export type DomainRegion = DomainBaseEntity &
  DomainEntityRefs & {
    parentId: string;
  };

export type DomainSector = DomainBaseEntity & DomainEntityRefs;

export type DomainSignal = DomainBaseEntity &
  DomainEntityRefs & {
    polarity: "warning" | "stabilizing" | "context" | "unknown";
  };

export type DomainRisk = DomainBaseEntity & DomainEntityRefs;

export type DomainSourceHint = DomainBaseEntity & {
  sourceType: "official" | "trade_data" | "maritime" | "corporate" | "media" | "research" | "unknown";
  reliabilityNote: string;
};

export type DomainOntology = {
  ontologyId: string;
  version: string;
  title: string;
  description: string;
  limits: string[];
  actors: DomainActor[];
  regions: DomainRegion[];
  sectors: DomainSector[];
  signals: DomainSignal[];
  risks: DomainRisk[];
  sourceHints: DomainSourceHint[];
};

export type ScenarioHypothesis = {
  id: string;
  title: string;
  statement: string;
  indicatorSignalIds: string[];
  disconfirmingSignalIds: string[];
};

export type DomainScenarioTemplate = DomainEntityRefs & {
  id: string;
  title: string;
  summary: string;
  domainTags: string[];
  triggerTerms: string[];
  hypotheses: ScenarioHypothesis[];
  analystPrompts: string[];
};

export type DomainScenarioLibrary = {
  libraryId: string;
  version: string;
  title: string;
  description: string;
  templates: DomainScenarioTemplate[];
};

export type DomainMatchedTerm = {
  kind: DomainEntityKind | "scenario";
  id: string;
  label: string;
  matched: string;
  source: "query" | "scenario" | "linked";
};

export type DomainExpandedTerms = {
  actors: string[];
  regions: string[];
  sectors: string[];
  signals: string[];
  risks: string[];
  sourceHints: string[];
  scenarios: string[];
};

export type DomainQueryExpansion = {
  query: string;
  normalizedQuery: string;
  matchedTerms: DomainMatchedTerm[];
  actors: DomainActor[];
  regions: DomainRegion[];
  sectors: DomainSector[];
  signals: DomainSignal[];
  risks: DomainRisk[];
  sourceHints: DomainSourceHint[];
  scenarios: DomainScenarioTemplate[];
  expandedTerms: DomainExpandedTerms;
  warnings: string[];
};

