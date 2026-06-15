# WARDEN P10 Supply-Chain Domain Grounding

P10 adds deterministic, local-only grounding for Korea and Northeast Asia supply-chain questions. It does not perform live OSINT and must not be presented as current external evidence.

## Owned Modules

- `src/agent/domain/question-classifier.ts`
  - Classifies whether a user question belongs to `defense_supply_chain`.
  - Extracts intent, region, sector, risk themes, and retrieval tags.
- `src/agent/domain/supply-chain-profile.ts`
  - Loads the offline Korea/Northeast Asia profile fixture.
  - Validates fixture shape.
  - Converts profile claims into existing `KnowledgeUnit` objects.
- `src/agent/knowledge/retrieval.ts`
  - Scores `KnowledgeUnit` candidates using tag match, lexical overlap, and reliability.
  - Provides `retrieveSupplyChainGrounding()` for one-shot local grounding.
- `fixtures/domain/korea-northeast-asia-supply-chain.json`
  - Offline grounding fixture for overview, semiconductor, battery/minerals, defense, and logistics/chokepoint framing.

## Classification Patterns

Core supply-chain signals:

- Korean: `공급망`, `조달망`, `공급선`, `밸류체인`, `부품 수급`, `소재 수급`, `원자재 수급`
- English: `supply chain`, `value chain`, `procurement`, `sourcing`

Intent classes:

- `overview`: broad explain/summarize questions
- `risk_assessment`: risk, vulnerability, exposure questions
- `actor_mapping`: supplier, buyer, country, firm mapping questions
- `chokepoint_analysis`: chokepoint, logistics bottleneck questions
- `scenario_monitoring`: indicator and warning questions
- `evidence_request`: source and evidence questions

Region classes:

- `south_korea`
- `northeast_asia`
- `china`
- `japan`
- `taiwan`
- `united_states`
- `global`

Sector classes:

- `semiconductor`
- `battery`
- `critical_minerals`
- `defense`
- `shipbuilding`
- `energy`
- `logistics`
- `industrial`
- `general`

Risk themes:

- `export_controls`
- `sanctions`
- `single_point_dependency`
- `stockpiling`
- `logistics_disruption`
- `price_shock`
- `technology_controls`
- `demand_shock`

## Retrieval Behavior

`retrieveKnowledgeUnits()` ranks candidates with:

- 45% lexical overlap between the question and the unit corpus text
- 45% tag overlap between classifier-generated tags and unit tags
- 10% reliability score derived from A/B/C-style reliability labels

`retrieveSupplyChainGrounding(question)` performs:

1. `classifySupplyChainQuestion(question)`
2. `loadKoreaNortheastAsiaSupplyChainProfile()`
3. `buildSupplyChainKnowledgeUnits(profile)`
4. `retrieveKnowledgeUnits(question, units, { queryTags: classification.retrievalTags })`
5. optional local answer frame selection by intent

## Boundary Rules

- P10 fixture claims are local grounding only.
- If external OSINT is pending approval, P10 results may support a scoped local answer but cannot claim live confirmation.
- The answer layer should label retrieved P10 claims as local profile grounding.
- SourceVet should be re-enabled once live documents or external sources are added.

## Integration Points

These are intentionally not wired in this bounded P10 patch:

- Runtime loop: call `retrieveSupplyChainGrounding(objective)` before composing the final answer.
- Answer composer: add retrieved snippets to `evidenceUsed` and domain limits to `uncertainty`.
- Team runner/evidence curator: optionally seed `KnowledgeUnit[]` with `buildSupplyChainKnowledgeUnits()` when classifier domain is `defense_supply_chain`.
- CLI: optionally show a compact `도메인 근거` panel before ACH status.
- Package scripts: add `demo:warden:domain` pointing at `demo/run-warden-domain-regression.ts`.
