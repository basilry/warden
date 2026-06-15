import {
  classifySupplyChainQuestion,
  explainSupplyChainClassification
} from "../src/agent/domain/question-classifier.ts";
import {
  buildSupplyChainKnowledgeUnits,
  loadKoreaNortheastAsiaSupplyChainProfile,
  validateSupplyChainDomainProfile
} from "../src/agent/domain/supply-chain-profile.ts";
import {
  renderRetrievalSummary,
  retrieveKnowledgeUnits,
  retrieveSupplyChainGrounding
} from "../src/agent/knowledge/retrieval.ts";

const overviewQuestion = "대한민국 및 동북아 공급망에 대해 알려줘";
const riskQuestion = "한국 배터리와 반도체 핵심 소재 공급망 리스크를 정리해줘";

const profile = loadKoreaNortheastAsiaSupplyChainProfile();
const profileWarnings = validateSupplyChainDomainProfile(profile);
assertEqual(profileWarnings.length, 0, "profile validation warning count");

const units = buildSupplyChainKnowledgeUnits(profile);
assertAtLeast(units.length, 8, "profile knowledge unit count");

const overviewClassification = classifySupplyChainQuestion(overviewQuestion);
assertEqual(overviewClassification.isSupplyChainQuestion, true, "overview supply-chain classification");
assertIncludes(overviewClassification.regions, "south_korea", "overview region south_korea");
assertIncludes(overviewClassification.regions, "northeast_asia", "overview region northeast_asia");
assertIncludes(overviewClassification.sectors, "general", "overview default sector");
assertIncludes(overviewClassification.retrievalTags, "topic:supply_chain", "overview retrieval tag");

const overviewGrounding = retrieveSupplyChainGrounding(overviewQuestion, { limit: 4 });
assertAtLeast(overviewGrounding.retrieval.items.length, 2, "overview retrieval item count");
assertEqual(overviewGrounding.answerFrame?.intent, "overview", "overview answer frame");
assertTopIncludes(overviewGrounding.retrieval.items[0]?.unit.tags ?? [], "region:northeast_asia", "overview top region tag");

const riskClassification = classifySupplyChainQuestion(riskQuestion);
assertEqual(riskClassification.isSupplyChainQuestion, true, "risk supply-chain classification");
assertIncludes(riskClassification.sectors, "battery", "risk sector battery");
assertIncludes(riskClassification.sectors, "semiconductor", "risk sector semiconductor");
assertIncludes(riskClassification.riskThemes, "single_point_dependency", "risk theme dependency");

const riskRetrieval = retrieveKnowledgeUnits(riskQuestion, units, {
  limit: 5,
  queryTags: riskClassification.retrievalTags
});
assertAtLeast(riskRetrieval.items.length, 3, "risk retrieval item count");
assertSomeItemHasTag(riskRetrieval.items, "sector:battery", "risk retrieval battery tag");
assertSomeItemHasTag(riskRetrieval.items, "sector:semiconductor", "risk retrieval semiconductor tag");

const nonDomain = classifySupplyChainQuestion("오늘 날씨 알려줘");
assertEqual(nonDomain.isSupplyChainQuestion, false, "non-domain classification");

console.log("WARDEN domain regression: passed");
console.log(explainSupplyChainClassification(overviewClassification));
console.log(renderRetrievalSummary(overviewGrounding.retrieval));

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}

function assertAtLeast(actual: number, minimum: number, label: string): void {
  if (actual < minimum) {
    throw new Error(`${label} failed: expected >= ${minimum} actual=${actual}`);
  }
}

function assertIncludes<T>(items: T[], expected: T, label: string): void {
  if (!items.includes(expected)) {
    throw new Error(`${label} missing ${String(expected)} in ${items.map(String).join(", ")}`);
  }
}

function assertTopIncludes(items: string[], expected: string, label: string): void {
  if (!items.includes(expected)) {
    throw new Error(`${label} missing ${expected} in top item tags: ${items.join(", ")}`);
  }
}

function assertSomeItemHasTag(items: Array<{ unit: { tags: string[] } }>, expected: string, label: string): void {
  if (!items.some((item) => item.unit.tags.includes(expected))) {
    throw new Error(`${label} missing ${expected} in retrieved tags.`);
  }
}
