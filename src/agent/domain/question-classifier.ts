export type SupplyChainIntent =
  | "overview"
  | "risk_assessment"
  | "actor_mapping"
  | "chokepoint_analysis"
  | "scenario_monitoring"
  | "evidence_request"
  | "unknown";

export type SupplyChainRegion =
  | "south_korea"
  | "northeast_asia"
  | "china"
  | "japan"
  | "taiwan"
  | "united_states"
  | "global";

export type SupplyChainSector =
  | "semiconductor"
  | "battery"
  | "critical_minerals"
  | "defense"
  | "shipbuilding"
  | "energy"
  | "logistics"
  | "industrial"
  | "general";

export type SupplyChainRiskTheme =
  | "export_controls"
  | "sanctions"
  | "single_point_dependency"
  | "stockpiling"
  | "logistics_disruption"
  | "price_shock"
  | "technology_controls"
  | "demand_shock"
  | "unknown";

export type MatchedQuestionPattern = {
  type: "core" | "intent" | "region" | "sector" | "risk";
  value: string;
  pattern: string;
};

export type DomainQuestionClassification = {
  domain: "defense_supply_chain" | "unknown";
  isSupplyChainQuestion: boolean;
  confidence: number;
  intents: SupplyChainIntent[];
  regions: SupplyChainRegion[];
  sectors: SupplyChainSector[];
  riskThemes: SupplyChainRiskTheme[];
  retrievalTags: string[];
  matchedPatterns: MatchedQuestionPattern[];
  normalizedQuestion: string;
  warnings: string[];
};

type PatternMap<T extends string> = Record<T, string[]>;

const CORE_PATTERNS = [
  "공급망",
  "조달망",
  "공급선",
  "밸류체인",
  "가치사슬",
  "부품 수급",
  "소재 수급",
  "원자재 수급",
  "supply chain",
  "value chain",
  "procurement",
  "sourcing"
];

const INTENT_PATTERNS: PatternMap<SupplyChainIntent> = {
  overview: ["알려줘", "개요", "현황", "요약", "정리", "overview", "brief", "summary"],
  risk_assessment: ["리스크", "위험", "취약", "불안", "평가", "risk", "vulnerability", "exposure"],
  actor_mapping: ["누가", "기업", "국가", "업체", "공급자", "수요처", "actor", "supplier", "buyer"],
  chokepoint_analysis: ["병목", "초크포인트", "관문", "해협", "항만", "chokepoint", "bottleneck"],
  scenario_monitoring: ["시나리오", "징후", "모니터링", "조기경보", "indicator", "monitoring"],
  evidence_request: ["근거", "출처", "자료", "데이터", "evidence", "source", "reference"],
  unknown: []
};

const REGION_PATTERNS: PatternMap<SupplyChainRegion> = {
  south_korea: ["대한민국", "한국", "국내", "korea", "south korea", "rok"],
  northeast_asia: ["동북아", "동아시아", "한중일", "northeast asia", "east asia"],
  china: ["중국", "cn", "china", "prc"],
  japan: ["일본", "jp", "japan"],
  taiwan: ["대만", "타이완", "taiwan", "tw"],
  united_states: ["미국", "us", "usa", "united states"],
  global: ["글로벌", "세계", "해외", "global", "worldwide"]
};

const SECTOR_PATTERNS: PatternMap<SupplyChainSector> = {
  semiconductor: ["반도체", "칩", "파운드리", "메모리", "semiconductor", "chip", "foundry"],
  battery: ["배터리", "이차전지", "양극재", "음극재", "전해액", "battery", "cathode", "anode"],
  critical_minerals: ["핵심광물", "희토류", "리튬", "니켈", "코발트", "흑연", "rare earth", "lithium", "nickel", "cobalt", "graphite"],
  defense: ["방산", "국방", "무기", "군수", "defense", "munition", "aerospace"],
  shipbuilding: ["조선", "선박", "해양", "shipbuilding", "maritime"],
  energy: ["에너지", "가스", "석유", "전력", "energy", "gas", "oil", "power"],
  logistics: ["물류", "항만", "해운", "운송", "logistics", "shipping", "port"],
  industrial: ["제조", "산업", "공장", "부품", "소재", "industrial", "manufacturing"],
  general: []
};

const RISK_PATTERNS: PatternMap<SupplyChainRiskTheme> = {
  export_controls: ["수출통제", "수출 규제", "export control", "export restriction"],
  sanctions: ["제재", "sanction", "entity list"],
  single_point_dependency: [
    "의존",
    "독점",
    "단일 공급",
    "핵심 소재",
    "핵심 부품",
    "중요 부품",
    "single source",
    "dependency",
    "concentration",
    "critical material",
    "critical component"
  ],
  stockpiling: ["비축", "재고", "stockpile", "inventory"],
  logistics_disruption: ["물류 차질", "항만 차질", "운송 차질", "봉쇄", "disruption", "blockade"],
  price_shock: ["가격", "급등", "가격 충격", "price shock", "spike"],
  technology_controls: ["기술통제", "기술 규제", "첨단", "technology control", "advanced technology"],
  demand_shock: ["수요", "발주", "취소", "demand shock", "order cancellation"],
  unknown: []
};

export function classifySupplyChainQuestion(question: string): DomainQuestionClassification {
  const normalizedQuestion = normalizeQuestion(question);
  const matchedPatterns: MatchedQuestionPattern[] = [];

  for (const pattern of CORE_PATTERNS) {
    if (matches(normalizedQuestion, pattern)) {
      matchedPatterns.push({ type: "core", value: "supply_chain", pattern });
    }
  }

  const intents = matchMap(normalizedQuestion, INTENT_PATTERNS, "intent", matchedPatterns);
  const regions = matchMap(normalizedQuestion, REGION_PATTERNS, "region", matchedPatterns);
  const sectors = matchMap(normalizedQuestion, SECTOR_PATTERNS, "sector", matchedPatterns);
  const riskThemes = matchMap(normalizedQuestion, RISK_PATTERNS, "risk", matchedPatterns);

  const hasCore = matchedPatterns.some((pattern) => pattern.type === "core");
  const inferredIntents = intents.length > 0 ? intents : (["unknown"] satisfies SupplyChainIntent[]);
  const inferredSectors = sectors.length > 0 ? sectors : hasCore ? (["general"] satisfies SupplyChainSector[]) : [];
  const inferredRisks = riskThemes.length > 0 ? riskThemes : hasCore ? (["unknown"] satisfies SupplyChainRiskTheme[]) : [];
  const confidence = scoreClassification({
    hasCore,
    intents: inferredIntents,
    regions,
    sectors: inferredSectors,
    riskThemes: inferredRisks
  });
  const isSupplyChainQuestion = hasCore && confidence >= 0.45;

  return {
    domain: isSupplyChainQuestion ? "defense_supply_chain" : "unknown",
    isSupplyChainQuestion,
    confidence,
    intents: inferredIntents,
    regions,
    sectors: inferredSectors,
    riskThemes: inferredRisks,
    retrievalTags: buildRetrievalTags({
      isSupplyChainQuestion,
      intents: inferredIntents,
      regions,
      sectors: inferredSectors,
      riskThemes: inferredRisks
    }),
    matchedPatterns,
    normalizedQuestion,
    warnings: buildClassificationWarnings(question, hasCore, regions, inferredSectors)
  };
}

export function isSupplyChainDomainQuestion(question: string): boolean {
  return classifySupplyChainQuestion(question).isSupplyChainQuestion;
}

export function explainSupplyChainClassification(classification: DomainQuestionClassification): string {
  if (!classification.isSupplyChainQuestion) {
    return `도메인 미분류: confidence=${classification.confidence.toFixed(2)}.`;
  }
  return [
    `도메인=defense_supply_chain confidence=${classification.confidence.toFixed(2)}`,
    `intent=${classification.intents.join(",")}`,
    `region=${classification.regions.join(",") || "unspecified"}`,
    `sector=${classification.sectors.join(",")}`,
    `risk=${classification.riskThemes.join(",")}`
  ].join(" ");
}

export function normalizeQuestion(question: string): string {
  return question
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchMap<T extends string>(
  normalizedQuestion: string,
  map: PatternMap<T>,
  type: MatchedQuestionPattern["type"],
  matchedPatterns: MatchedQuestionPattern[]
): T[] {
  const values: T[] = [];
  for (const [value, patterns] of Object.entries(map) as Array<[T, string[]]>) {
    for (const pattern of patterns) {
      if (!matches(normalizedQuestion, pattern)) continue;
      if (!values.includes(value)) values.push(value);
      matchedPatterns.push({ type, value, pattern });
      break;
    }
  }
  return values;
}

function matches(normalizedQuestion: string, pattern: string): boolean {
  return normalizedQuestion.includes(pattern.toLowerCase());
}

function scoreClassification(input: {
  hasCore: boolean;
  intents: SupplyChainIntent[];
  regions: SupplyChainRegion[];
  sectors: SupplyChainSector[];
  riskThemes: SupplyChainRiskTheme[];
}): number {
  const coreScore = input.hasCore ? 0.45 : 0;
  const intentScore = input.intents.some((intent) => intent !== "unknown") ? 0.15 : 0.04;
  const regionScore = Math.min(input.regions.length, 2) * 0.12;
  const sectorScore = input.sectors.some((sector) => sector !== "general") ? 0.14 : input.hasCore ? 0.06 : 0;
  const riskScore = input.riskThemes.some((risk) => risk !== "unknown") ? 0.1 : input.hasCore ? 0.03 : 0;
  return Math.min(1, Number((coreScore + intentScore + regionScore + sectorScore + riskScore).toFixed(2)));
}

function buildRetrievalTags(input: {
  isSupplyChainQuestion: boolean;
  intents: SupplyChainIntent[];
  regions: SupplyChainRegion[];
  sectors: SupplyChainSector[];
  riskThemes: SupplyChainRiskTheme[];
}): string[] {
  if (!input.isSupplyChainQuestion) return [];
  return uniqueNonEmpty([
    "domain:defense_supply_chain",
    "topic:supply_chain",
    ...input.intents.filter((item) => item !== "unknown").map((item) => `intent:${item}`),
    ...input.regions.map((item) => `region:${item}`),
    ...input.sectors.map((item) => `sector:${item}`),
    ...input.riskThemes.filter((item) => item !== "unknown").map((item) => `risk:${item}`)
  ]);
}

function buildClassificationWarnings(
  question: string,
  hasCore: boolean,
  regions: SupplyChainRegion[],
  sectors: SupplyChainSector[]
): string[] {
  const warnings: string[] = [];
  if (question.trim().length === 0) warnings.push("질문이 비어 있습니다.");
  if (!hasCore) warnings.push("공급망/조달망 핵심 표현이 없어 P10 도메인 검색 대상에서 제외됩니다.");
  if (hasCore && regions.length === 0) warnings.push("지역이 명시되지 않아 profile 기본 범위로 검색합니다.");
  if (hasCore && sectors.length === 0) warnings.push("산업 분야가 명시되지 않아 general 공급망 프레임으로 검색합니다.");
  return warnings;
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
