import type { AchAnalysisResult } from "../agent/types.ts";

export type SurvivorDelta = {
  added: string[];
  removed: string[];
  unchanged: string[];
};

export function calculateSurvivorDelta(
  before: AchAnalysisResult | undefined,
  after: AchAnalysisResult | undefined
): SurvivorDelta {
  const beforeSet = new Set(before?.survivors ?? []);
  const afterSet = new Set(after?.survivors ?? []);
  return {
    added: [...afterSet].filter((item) => !beforeSet.has(item)).sort(),
    removed: [...beforeSet].filter((item) => !afterSet.has(item)).sort(),
    unchanged: [...afterSet].filter((item) => beforeSet.has(item)).sort()
  };
}

export function renderSurvivorDelta(delta: SurvivorDelta): string {
  const added = delta.added.length > 0 ? `추가=${delta.added.join(", ")}` : "추가=없음";
  const removed = delta.removed.length > 0 ? `제거=${delta.removed.join(", ")}` : "제거=없음";
  const unchanged = delta.unchanged.length > 0 ? `유지=${delta.unchanged.join(", ")}` : "유지=없음";
  return `승인 후 ACH 재평가 변화: ${added}; ${removed}; ${unchanged}.`;
}
