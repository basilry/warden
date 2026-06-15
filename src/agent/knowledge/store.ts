import type { KnowledgeUnit } from "../types.ts";

export type KnowledgeStore = {
  addKnowledgeUnits(units: KnowledgeUnit[]): void;
  findKnowledgeUnitsByTag(tag: string): KnowledgeUnit[];
  getKnowledgeUnit(id: string): KnowledgeUnit | undefined;
  listKnowledgeUnits(): KnowledgeUnit[];
};

export function createKnowledgeStore(): KnowledgeStore {
  const units = new Map<string, KnowledgeUnit>();

  return {
    addKnowledgeUnits(items) {
      for (const item of items) {
        units.set(item.id, item);
      }
    },
    findKnowledgeUnitsByTag(tag) {
      return [...units.values()].filter((unit) => unit.tags.includes(tag));
    },
    getKnowledgeUnit(id) {
      return units.get(id);
    },
    listKnowledgeUnits() {
      return [...units.values()];
    }
  };
}

export function renderKnowledgeSummary(units: KnowledgeUnit[]): string {
  if (units.length === 0) {
    return "No knowledge units.";
  }
  return units
    .map((unit) => {
      const reliability = unit.reliability ?? "unrated";
      const claim = unit.claims[0]?.text ?? "(no claim)";
      return `- ${unit.id} [${reliability}] ${claim}`;
    })
    .join("\n");
}
