import { buildInvestigationPlan } from "../src/runtime/investigation-planner.ts";
import { validateInvestigationPlan } from "../src/runtime/investigation-plan-schema.ts";

const taiwanObjective = "중국의 대만 침공 가능성을 평가해줘";
const taiwanPlan = buildInvestigationPlan(taiwanObjective);

assertEqual(taiwanPlan.source, "deterministic_fallback", "Taiwan plan source");
assertEqual(taiwanPlan.classification.scenario, "taiwan_invasion", "Taiwan scenario");
assertEqual(taiwanPlan.domain, "mixed", "Taiwan domain");
assertAtLeast(taiwanPlan.hypotheses.length, 3, "Taiwan hypothesis count");
assertAtLeast(taiwanPlan.searchPlan.length, 3, "Taiwan search-plan count");

const taiwanHypotheses = taiwanPlan.hypotheses.map((hypothesis) => hypothesis.statement).join("\n");
const taiwanSearchPlan = taiwanPlan.searchPlan.map((step) => `${step.query} ${step.tags.join(" ")}`).join("\n");

assertIncludes(taiwanHypotheses, "Taiwan", "Taiwan hypotheses should name Taiwan");
assertIncludes(taiwanHypotheses, "PLA", "Taiwan hypotheses should include PLA-specific signals");
assertIncludes(taiwanSearchPlan, "Taiwan", "Taiwan search plan should include Taiwan-specific queries");
assertIncludes(taiwanSearchPlan, "대만", "Taiwan search plan should include Korean Taiwan queries");

assertNotIncludes(taiwanHypotheses, "제재 우회 비축", "Taiwan hypotheses must not use legacy supply-chain hypothesis");
assertNotIncludes(taiwanHypotheses, "단순 수요 감소", "Taiwan hypotheses must not use legacy demand hypothesis");
assertNotIncludes(taiwanHypotheses, "공급망 교란", "Taiwan hypotheses must not use legacy supply-chain disruption hypothesis");
assertNotIncludes(taiwanSearchPlan, "공급망", "Taiwan search plan must not fall back to Korean supply-chain search");
assertNotIncludes(taiwanSearchPlan.toLowerCase(), "supply chain", "Taiwan search plan must not fall back to supply-chain search");

const validation = validateInvestigationPlan(taiwanPlan, { objective: taiwanPlan.objective });
assertEqual(validation.status, "pass", "Taiwan plan schema validation");
assertEqual(validation.errors.length, 0, "Taiwan plan validation errors");

const modelPlan = buildInvestigationPlan(taiwanObjective, JSON.stringify(taiwanPlan));
assertEqual(modelPlan.source, "model_proposal", "JSON model proposal source");
assertEqual(modelPlan.classification.scenario, "taiwan_invasion", "JSON model proposal scenario");

const invalidModelPlan = buildInvestigationPlan(taiwanObjective, "{bad-json");
assertEqual(invalidModelPlan.source, "deterministic_fallback", "invalid model proposal fallback source");
assertIncludes(invalidModelPlan.warnings.join("\n"), "not valid JSON", "invalid JSON warning");
assertEqual(invalidModelPlan.classification.scenario, "taiwan_invasion", "invalid model proposal preserves deterministic Taiwan scenario");

const allianceObjective = "이재명 대통령의 북중러 친밀도 강화와 반미 정책에 대한 미국의 반응";
const alliancePlan = buildInvestigationPlan(allianceObjective);
assertEqual(alliancePlan.classification.scenario, "us_alliance_response", "US alliance response scenario");
assertEqual(alliancePlan.domain, "geopolitics", "US alliance response domain");
assertAtLeast(alliancePlan.hypotheses.length, 3, "US alliance response hypothesis count");

const allianceHypotheses = alliancePlan.hypotheses.map((hypothesis) => hypothesis.statement).join("\n");
const allianceSearchPlan = alliancePlan.searchPlan.map((step) => `${step.query} ${step.tags.join(" ")}`).join("\n");

assertIncludes(allianceHypotheses, "United States", "US alliance hypotheses should name the United States");
assertIncludes(allianceHypotheses, "alliance", "US alliance hypotheses should include alliance-management framing");
assertIncludes(allianceSearchPlan, "State Department", "US alliance search plan should include official US response queries");
assertIncludes(allianceSearchPlan, "Reuters", "US alliance search plan should include diverse international media queries");
assertNotIncludes(allianceHypotheses, "routine activity", "US alliance hypotheses must not use generic-security fallback hypothesis");
assertNotIncludes(allianceHypotheses, "misreporting", "US alliance hypotheses must not use generic-security fallback hypothesis");

const allianceValidation = validateInvestigationPlan(alliancePlan, { objective: alliancePlan.objective });
assertEqual(allianceValidation.status, "pass", "US alliance plan schema validation");
assertEqual(allianceValidation.errors.length, 0, "US alliance plan validation errors");

const claimObjective = "일본 다카이치 총리와 자민당의 비반트를 활용한 한반도 재점령 및 만주수복 계획에 대한 실제여부 검증";
const claimPlan = buildInvestigationPlan(claimObjective);
assertEqual(claimPlan.classification.scenario, "claim_verification", "claim verification scenario");
assertEqual(claimPlan.domain, "geopolitics", "claim verification domain");

const claimHypotheses = claimPlan.hypotheses.map((hypothesis) => hypothesis.statement).join("\n");
const claimSearchPlan = claimPlan.searchPlan.map((step) => `${step.query} ${step.tags.join(" ")}`).join("\n");

assertIncludes(claimHypotheses, "unsupported or false", "claim verification should test unsupported/false hypothesis");
assertIncludes(claimSearchPlan, "Takaichi", "claim verification search plan should include Takaichi");
assertIncludes(claimSearchPlan, "VIVANT", "claim verification search plan should include VIVANT");
assertIncludes(claimSearchPlan, "official", "claim verification search plan should prioritize official sources");
assertNotIncludes(claimHypotheses, "routine activity", "claim verification must not use generic-security fallback hypothesis");

const claimValidation = validateInvestigationPlan(claimPlan, { objective: claimPlan.objective });
assertEqual(claimValidation.status, "pass", "claim verification plan schema validation");
assertEqual(claimValidation.errors.length, 0, "claim verification plan validation errors");

console.log("WARDEN investigation plan regression: passed");

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

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}

function assertNotIncludes(value: string, expected: string, label: string): void {
  if (value.includes(expected)) {
    throw new Error(`${label} unexpectedly included: ${expected}\n${value}`);
  }
}
