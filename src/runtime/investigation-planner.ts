import {
  INVESTIGATION_PLAN_SCHEMA_VERSION,
  isInvestigationDomain,
  isInvestigationPriority,
  isRecord,
  parseInvestigationPlanProposal,
  readString,
  readStringArray,
  uniqueNonEmpty,
  validateInvestigationPlanProposal,
  type InvestigationClassification,
  type InvestigationDomain,
  type InvestigationHypothesis,
  type InvestigationPlan,
  type InvestigationPlanSource,
  type InvestigationScenario,
  type InvestigationSearchStep
} from "./investigation-plan-schema.ts";

export type InvestigationPlanContext = {
  currentDate?: string;
  language?: "en" | "ko" | "mixed";
  sourceHints?: string[];
};

type ScenarioTemplate = {
  scenario: InvestigationScenario;
  domain: InvestigationDomain;
  title: string;
  hypotheses: HypothesisTemplate[];
  searchPlan: InvestigationSearchStep[];
};

type HypothesisTemplate = Omit<InvestigationHypothesis, "label" | "indicators" | "disconfirmingIndicators"> &
  Partial<Pick<InvestigationHypothesis, "label" | "indicators" | "disconfirmingIndicators">>;

export function buildInvestigationPlan(
  objective: string,
  model?: unknown,
  context: InvestigationPlanContext = {}
): InvestigationPlan {
  const fallback = buildDeterministicInvestigationPlan(objective, context);
  if (model === undefined) return fallback;

  const modelOutput = readModelOutput(model);
  const parseResult = parseInvestigationPlanProposal(modelOutput);
  if (!parseResult.proposal) {
    return withWarnings(fallback, parseResult.warnings);
  }

  const validation = validateInvestigationPlanProposal(parseResult.proposal, { objective });
  if (validation.status === "fail") {
    return withWarnings(fallback, [
      ...parseResult.warnings,
      ...validation.errors.map((error) => `model proposal validation error: ${error}`),
      ...validation.warnings.map((warning) => `model proposal validation warning: ${warning}`)
    ]);
  }

  return normalizeModelProposal(parseResult.proposal, {
    requestedObjective: normalizeObjective(objective).objective,
    fallbackClassification: fallback.classification,
    warnings: [
      ...parseResult.warnings,
      ...validation.warnings.map((warning) => `model proposal validation warning: ${warning}`)
    ],
    source: "model_proposal"
  });
}

export function buildDeterministicInvestigationPlan(
  objective: string,
  context: InvestigationPlanContext = {}
): InvestigationPlan {
  const normalized = normalizeObjective(objective);
  const classification = classifyInvestigationObjective(normalized.objective, context);
  const template = getScenarioTemplate(classification.scenario);
  const plan: InvestigationPlan = {
    schemaVersion: INVESTIGATION_PLAN_SCHEMA_VERSION,
    objective: normalized.objective,
    title: template.title,
    domain: template.domain,
    classification,
    hypotheses: cloneHypotheses(template.hypotheses),
    searchPlan: applySearchContext(cloneSearchPlan(template.searchPlan), context),
    source: "deterministic_fallback",
    warnings: normalized.warnings
  };

  const validation = validateInvestigationPlanProposal(plan, { objective: normalized.objective });
  if (validation.status === "pass") {
    return {
      ...plan,
      warnings: uniqueNonEmpty([...plan.warnings, ...validation.warnings])
    };
  }

  return {
    ...plan,
    warnings: uniqueNonEmpty([
      ...plan.warnings,
      ...validation.errors.map((error) => `deterministic fallback validation error: ${error}`),
      ...validation.warnings.map((warning) => `deterministic fallback validation warning: ${warning}`)
    ])
  };
}

export function classifyInvestigationObjective(
  objective: string,
  _context: InvestigationPlanContext = {}
): InvestigationClassification {
  const normalized = normalizeText(objective);

  const taiwanSignals = matchSignals(normalized, [
    "taiwan",
    "taiwan strait",
    "대만",
    "타이완",
    "침공",
    "invasion",
    "amphibious",
    "상륙",
    "blockade",
    "봉쇄",
    "pla",
    "인민해방군"
  ]);
  if (hasAny(taiwanSignals, ["taiwan", "taiwan strait", "대만", "타이완"]) && hasAny(taiwanSignals, ["침공", "invasion", "amphibious", "상륙", "blockade", "봉쇄", "pla", "인민해방군"])) {
    return buildClassification("taiwan_invasion", "mixed", 0.92, taiwanSignals);
  }

  const controlsSignals = matchSignals(normalized, [
    "sanction",
    "sanctions",
    "제재",
    "export control",
    "export controls",
    "export restriction",
    "수출통제",
    "수출 통제",
    "수출 규제",
    "entity list",
    "blacklist",
    "블랙리스트"
  ]);
  if (controlsSignals.length > 0) {
    return buildClassification("sanctions_export_controls", "economic_security", 0.88, controlsSignals);
  }

  const supplyChainSignals = matchSignals(normalized, [
    "supply chain",
    "supply-chain",
    "procurement",
    "sourcing",
    "공급망",
    "조달망",
    "공급선",
    "korea",
    "south korea",
    "rok",
    "한국",
    "대한민국",
    "northeast asia",
    "northeast-asian",
    "동북아",
    "동아시아"
  ]);
  if (
    hasAny(supplyChainSignals, ["supply chain", "supply-chain", "procurement", "sourcing", "공급망", "조달망", "공급선"]) &&
    hasAny(supplyChainSignals, ["korea", "south korea", "rok", "한국", "대한민국", "northeast asia", "northeast-asian", "동북아", "동아시아"])
  ) {
    return buildClassification("korea_northeast_asia_supply_chain", "supply_chain", 0.9, supplyChainSignals);
  }

  const allianceSignals = matchSignals(normalized, [
    "united states",
    "u.s.",
    "us ",
    "america",
    "washington",
    "state department",
    "white house",
    "alliance",
    "anti-us",
    "anti u.s.",
    "pro-china",
    "china-friendly",
    "north korea",
    "russia",
    "미국",
    "워싱턴",
    "백악관",
    "국무부",
    "한미동맹",
    "동맹",
    "반미",
    "친중",
    "북중러",
    "북한",
    "중국",
    "러시아",
    "미국의 반응",
    "미 반응"
  ]);
  if (
    hasAny(allianceSignals, ["united states", "u.s.", "us ", "america", "washington", "state department", "white house", "미국", "워싱턴", "백악관", "국무부", "미국의 반응", "미 반응"]) &&
    hasAny(allianceSignals, ["alliance", "anti-us", "anti u.s.", "pro-china", "china-friendly", "north korea", "russia", "한미동맹", "동맹", "반미", "친중", "북중러", "북한", "중국", "러시아"])
  ) {
    return buildClassification("us_alliance_response", "geopolitics", 0.86, allianceSignals);
  }

  const verificationSignals = matchSignals(normalized, [
    "fact check",
    "fact-check",
    "verify",
    "verification",
    "debunk",
    "hoax",
    "conspiracy",
    "검증",
    "실제여부",
    "실제 여부",
    "사실 여부",
    "허위",
    "가짜",
    "음모",
    "비반트",
    "vivant",
    "재점령",
    "만주수복",
    "만주 수복",
    "reoccupation",
    "manchuria",
    "takaichi",
    "다카이치",
    "자민당",
    "ldp"
  ]);
  if (
    hasAny(verificationSignals, ["검증", "실제여부", "실제 여부", "사실 여부", "fact check", "fact-check", "verify", "verification", "debunk"]) ||
    hasAny(verificationSignals, ["비반트", "vivant", "재점령", "만주수복", "만주 수복", "reoccupation", "manchuria", "음모", "hoax", "conspiracy"])
  ) {
    return buildClassification("claim_verification", "geopolitics", 0.87, verificationSignals);
  }

  return buildClassification("generic_security", "security", 0.58, matchSignals(normalized, [
    "security",
    "risk",
    "threat",
    "conflict",
    "안보",
    "위협",
    "리스크",
    "분쟁"
  ]));
}

function getScenarioTemplate(scenario: InvestigationScenario): ScenarioTemplate {
  if (scenario === "taiwan_invasion") return TAIWAN_INVASION_TEMPLATE;
  if (scenario === "korea_northeast_asia_supply_chain") return KOREA_NORTHEAST_ASIA_SUPPLY_CHAIN_TEMPLATE;
  if (scenario === "sanctions_export_controls") return SANCTIONS_EXPORT_CONTROLS_TEMPLATE;
  if (scenario === "us_alliance_response") return US_ALLIANCE_RESPONSE_TEMPLATE;
  if (scenario === "claim_verification") return CLAIM_VERIFICATION_TEMPLATE;
  return GENERIC_SECURITY_TEMPLATE;
}

function normalizeModelProposal(
  proposal: unknown,
  options: {
    requestedObjective: string;
    fallbackClassification: InvestigationClassification;
    source: InvestigationPlanSource;
    warnings: string[];
  }
): InvestigationPlan {
  if (!isRecord(proposal)) {
    throw new Error("normalizeModelProposal requires an object proposal after validation.");
  }
  const domain = isInvestigationDomain(proposal.domain) ? proposal.domain : options.fallbackClassification.domain;
  return {
    schemaVersion: INVESTIGATION_PLAN_SCHEMA_VERSION,
    objective: options.requestedObjective,
    title: readString(proposal.title) ?? "Investigation Plan",
    domain,
    classification: readClassification(proposal.classification, options.fallbackClassification, domain),
    hypotheses: readHypotheses(proposal.hypotheses, domain),
    searchPlan: readSearchPlan(proposal.searchPlan),
    source: options.source,
    warnings: uniqueNonEmpty([
      ...options.warnings,
      ...("warnings" in proposal ? readStringArray(proposal.warnings) : [])
    ])
  };
}

function readClassification(
  value: unknown,
  fallback: InvestigationClassification,
  domain: InvestigationDomain
): InvestigationClassification {
  if (!isRecord(value)) return { ...fallback, domain };
  const scenario = readScenario(value.scenario) ?? fallback.scenario;
  const confidence =
    typeof value.confidence === "number" && value.confidence >= 0 && value.confidence <= 1 ? value.confidence : fallback.confidence;
  return {
    scenario,
    domain: isInvestigationDomain(value.domain) ? value.domain : domain,
    confidence,
    matchedSignals: readStringArray(value.matchedSignals)
  };
}

function readHypotheses(value: unknown, fallbackDomain: InvestigationDomain): InvestigationHypothesis[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item, index) => {
    const statement = readString(item.statement) ?? "Unspecified hypothesis.";
    const disconfirmingSignals = readStringArray(item.disconfirmingSignals);
    const disconfirmingIndicators = readStringArray(item.disconfirmingIndicators);
    const indicators = readStringArray(item.indicators);
    return {
      id: readString(item.id) ?? `h${index + 1}`,
      label: readString(item.label) ?? statement,
      statement,
      rationale: readString(item.rationale) ?? "Model proposal omitted rationale.",
      priority: isInvestigationPriority(item.priority) ? item.priority : "medium",
      domain: isInvestigationDomain(item.domain) ? item.domain : fallbackDomain,
      indicators: indicators.length > 0 ? indicators : [statement],
      disconfirmingSignals,
      disconfirmingIndicators: disconfirmingIndicators.length > 0 ? disconfirmingIndicators : disconfirmingSignals
    };
  });
}

function readSearchPlan(value: unknown): InvestigationSearchStep[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item, index) => ({
    id: readString(item.id) ?? `s${index + 1}`,
    query: readString(item.query) ?? "security investigation objective",
    purpose: readString(item.purpose) ?? "Gather public-source context for the investigation.",
    sourceTypes: readStringArray(item.sourceTypes),
    tags: readStringArray(item.tags)
  }));
}

function readScenario(value: unknown): InvestigationScenario | undefined {
  if (
    value === "taiwan_invasion" ||
    value === "korea_northeast_asia_supply_chain" ||
    value === "sanctions_export_controls" ||
    value === "us_alliance_response" ||
    value === "claim_verification" ||
    value === "generic_security"
  ) {
    return value;
  }
  return undefined;
}

function readModelOutput(model: unknown): unknown {
  if (isRecord(model) && "output" in model && ("model" in model || "warnings" in model || "id" in model)) {
    return model.output;
  }
  return model;
}

function normalizeObjective(objective: string): { objective: string; warnings: string[] } {
  const normalized = objective.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (normalized.length > 0) return { objective: normalized, warnings: [] };
  return {
    objective: "Unspecified security investigation objective",
    warnings: ["objective is empty; using generic security fallback objective."]
  };
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[“”"'`]/g, "").replace(/\s+/g, " ").trim();
}

function matchSignals(normalizedObjective: string, patterns: string[]): string[] {
  return uniqueNonEmpty(patterns.filter((pattern) => normalizedObjective.includes(pattern.toLowerCase())));
}

function hasAny(signals: string[], expected: string[]): boolean {
  return expected.some((value) => signals.includes(value));
}

function buildClassification(
  scenario: InvestigationScenario,
  domain: InvestigationDomain,
  confidence: number,
  matchedSignals: string[]
): InvestigationClassification {
  return {
    scenario,
    domain,
    confidence,
    matchedSignals: uniqueNonEmpty(matchedSignals)
  };
}

function cloneHypotheses(hypotheses: HypothesisTemplate[]): InvestigationHypothesis[] {
  return hypotheses.map((hypothesis) => {
    const disconfirmingSignals = [...hypothesis.disconfirmingSignals];
    return {
      ...hypothesis,
      label: hypothesis.label ?? hypothesis.statement,
      indicators: hypothesis.indicators ? [...hypothesis.indicators] : [hypothesis.statement],
      disconfirmingSignals,
      disconfirmingIndicators: hypothesis.disconfirmingIndicators ? [...hypothesis.disconfirmingIndicators] : disconfirmingSignals
    };
  });
}

function cloneSearchPlan(searchPlan: InvestigationSearchStep[]): InvestigationSearchStep[] {
  return searchPlan.map((step) => ({
    ...step,
    sourceTypes: [...step.sourceTypes],
    tags: [...step.tags]
  }));
}

function applySearchContext(searchPlan: InvestigationSearchStep[], context: InvestigationPlanContext): InvestigationSearchStep[] {
  const hints = uniqueNonEmpty(context.sourceHints ?? []);
  if (hints.length === 0 && !context.currentDate) return searchPlan;
  return searchPlan.map((step) => ({
    ...step,
    purpose: context.currentDate ? `${step.purpose} Reference date: ${context.currentDate}.` : step.purpose,
    tags: uniqueNonEmpty([...step.tags, ...hints.map((hint) => `hint:${hint}`)])
  }));
}

function withWarnings(plan: InvestigationPlan, warnings: string[]): InvestigationPlan {
  return {
    ...plan,
    warnings: uniqueNonEmpty([...plan.warnings, ...warnings])
  };
}

const TAIWAN_INVASION_TEMPLATE: ScenarioTemplate = {
  scenario: "taiwan_invasion",
  domain: "mixed",
  title: "Taiwan Strait Invasion Risk Investigation Plan",
  hypotheses: [
    {
      id: "tw-h1",
      statement:
        "A near-term Taiwan invasion window is being prepared through PLA mobilization, amphibious lift, missile activity, and civil-military logistics signals.",
      rationale: "A full invasion requires synchronized military readiness, transport capacity, command signaling, and sustainment indicators.",
      priority: "high",
      domain: "mixed",
      disconfirmingSignals: [
        "PLA activity remains within routine exercise bounds",
        "No unusual roll-on/roll-off ferry or amphibious logistics activation",
        "Taiwan civil defense and allied posture show no abnormal alerting"
      ]
    },
    {
      id: "tw-h2",
      statement: "Observed activity is coercive gray-zone pressure or exercise signaling rather than imminent invasion preparation.",
      rationale: "Beijing can create political pressure with air, naval, cyber, and information operations below the invasion threshold.",
      priority: "high",
      domain: "geopolitics",
      disconfirmingSignals: [
        "Sustained logistics staging exceeds prior exercise baselines",
        "Civil maritime assets are requisitioned for military support",
        "Leadership messaging shifts from deterrence to operational necessity"
      ]
    },
    {
      id: "tw-h3",
      statement: "A blockade, quarantine, or missile coercion pathway is more plausible than a full amphibious invasion.",
      rationale: "Limited coercive options can impose costs while avoiding the highest-risk cross-strait landing operation.",
      priority: "medium",
      domain: "defense",
      disconfirmingSignals: [
        "Landing craft, airborne, and logistics indicators dominate naval interdiction indicators",
        "Commercial shipping disruption remains absent",
        "Missile and naval exercises de-escalate quickly"
      ]
    }
  ],
  searchPlan: [
    {
      id: "tw-s1",
      query: "Taiwan Strait PLA amphibious lift mobilization invasion indicators",
      purpose: "Check whether public reporting shows invasion-enabling force movement rather than routine exercise activity.",
      sourceTypes: ["news", "defense-briefing", "official-statement"],
      tags: ["taiwan", "pla", "amphibious", "warning-indicators"]
    },
    {
      id: "tw-s2",
      query: "대만 침공 징후 중국 인민해방군 상륙 수송 동원",
      purpose: "Capture Korean-language reporting on cross-strait mobilization and amphibious transport indicators.",
      sourceTypes: ["news", "regional-analysis"],
      tags: ["대만", "침공", "인민해방군", "동원"]
    },
    {
      id: "tw-s3",
      query: "Taiwan ADIZ missile exercises naval blockade shipping alerts",
      purpose: "Separate air and missile pressure from blockade or quarantine indicators around Taiwan.",
      sourceTypes: ["official-statement", "maritime-tracker", "news"],
      tags: ["taiwan", "adiz", "missile", "blockade"]
    },
    {
      id: "tw-s4",
      query: "Taiwan civil defense reserve mobilization evacuation advisories",
      purpose: "Look for defensive readiness, evacuation, or allied alerting that would corroborate elevated invasion risk.",
      sourceTypes: ["official-statement", "news", "embassy-advisory"],
      tags: ["taiwan", "civil-defense", "reserve", "evacuation"]
    }
  ]
};

const KOREA_NORTHEAST_ASIA_SUPPLY_CHAIN_TEMPLATE: ScenarioTemplate = {
  scenario: "korea_northeast_asia_supply_chain",
  domain: "supply_chain",
  title: "Korea and Northeast Asia Supply-Chain Investigation Plan",
  hypotheses: [
    {
      id: "sc-h1",
      statement: "Korea and Northeast Asia exposure is driven by concentrated upstream inputs for semiconductors, batteries, or defense electronics.",
      rationale: "Concentration in critical inputs can create strategic vulnerability even when final assembly remains distributed.",
      priority: "high",
      domain: "supply_chain",
      disconfirmingSignals: [
        "Multiple qualified suppliers are available across jurisdictions",
        "Inventory and substitution capacity cover plausible disruption windows",
        "No evidence of supplier concentration in the target sector"
      ]
    },
    {
      id: "sc-h2",
      statement: "The primary risk is regional logistics interruption across ports, shipping lanes, or customs processes.",
      rationale: "Transport disruption can look like supply scarcity even when production capacity remains intact.",
      priority: "medium",
      domain: "supply_chain",
      disconfirmingSignals: [
        "Freight rates and port dwell times remain normal",
        "Affected firms report production rather than logistics constraints",
        "Alternative routes are already absorbing volume"
      ]
    },
    {
      id: "sc-h3",
      statement: "The issue is demand or inventory normalization rather than a structural supply-chain shock.",
      rationale: "Order cycles and inventory corrections can mimic geopolitical supply-chain stress in short windows.",
      priority: "medium",
      domain: "economic_security",
      disconfirmingSignals: [
        "Demand indicators remain stable while input delays worsen",
        "Regulatory or geopolitical triggers align with the disruption",
        "Multiple unrelated sectors report synchronized bottlenecks"
      ]
    }
  ],
  searchPlan: [
    {
      id: "sc-s1",
      query: "South Korea Northeast Asia semiconductor battery critical materials supply chain risk",
      purpose: "Map the affected sectors, upstream inputs, and regional exposure.",
      sourceTypes: ["news", "industry-report", "official-data"],
      tags: ["korea", "northeast-asia", "supply-chain", "critical-inputs"]
    },
    {
      id: "sc-s2",
      query: "대한민국 동북아 공급망 반도체 배터리 핵심 소재 리스크",
      purpose: "Capture Korean-language sector reporting and official framing.",
      sourceTypes: ["news", "official-statement", "industry-report"],
      tags: ["대한민국", "동북아", "공급망", "반도체", "배터리"]
    },
    {
      id: "sc-s3",
      query: "Northeast Asia port shipping customs delays strategic supply chain",
      purpose: "Test whether logistics indicators explain the observed disruption.",
      sourceTypes: ["logistics-data", "news", "industry-report"],
      tags: ["logistics", "ports", "customs", "northeast-asia"]
    }
  ]
};

const SANCTIONS_EXPORT_CONTROLS_TEMPLATE: ScenarioTemplate = {
  scenario: "sanctions_export_controls",
  domain: "economic_security",
  title: "Sanctions and Export Controls Investigation Plan",
  hypotheses: [
    {
      id: "ec-h1",
      statement: "New or tightened sanctions and export controls materially constrain the target actor's access to controlled goods or finance.",
      rationale: "Controls can change procurement routes, financing costs, supplier behavior, and compliance risk.",
      priority: "high",
      domain: "economic_security",
      disconfirmingSignals: [
        "No new designation, licensing, or control-list change is confirmed",
        "Target import or financing channels remain stable",
        "Suppliers report no compliance-driven change"
      ]
    },
    {
      id: "ec-h2",
      statement: "Evasion, substitution, or third-country routing is offsetting the intended pressure.",
      rationale: "Sanctions impact depends on enforcement quality and availability of substitute channels.",
      priority: "high",
      domain: "economic_security",
      disconfirmingSignals: [
        "Transit-country flows do not increase after controls",
        "Substitute suppliers lack the required capability",
        "Enforcement actions disrupt suspected channels"
      ]
    },
    {
      id: "ec-h3",
      statement: "The policy change is primarily signaling and has limited near-term operational effect.",
      rationale: "Some control announcements create deterrence or diplomatic signaling before measurable material effects appear.",
      priority: "medium",
      domain: "geopolitics",
      disconfirmingSignals: [
        "Licensing denials or seizures occur immediately",
        "Market prices or delivery times move sharply",
        "Firms publicly suspend affected transactions"
      ]
    }
  ],
  searchPlan: [
    {
      id: "ec-s1",
      query: "latest sanctions export controls entity list licensing restrictions target sector",
      purpose: "Identify the controlling legal or policy action and affected entities.",
      sourceTypes: ["official-statement", "regulation", "news"],
      tags: ["sanctions", "export-controls", "entity-list"]
    },
    {
      id: "ec-s2",
      query: "제재 수출통제 대상 기업 품목 우회 조달",
      purpose: "Capture Korean-language reporting on affected entities, goods, and possible evasion routes.",
      sourceTypes: ["news", "official-statement", "trade-data"],
      tags: ["제재", "수출통제", "우회", "조달"]
    },
    {
      id: "ec-s3",
      query: "export control evasion third country transshipment enforcement action",
      purpose: "Test whether circumvention or enforcement indicators change the likely impact.",
      sourceTypes: ["enforcement-release", "trade-data", "news"],
      tags: ["evasion", "transshipment", "enforcement"]
    }
  ]
};

const US_ALLIANCE_RESPONSE_TEMPLATE: ScenarioTemplate = {
  scenario: "us_alliance_response",
  domain: "geopolitics",
  title: "US Alliance Response Investigation Plan",
  hypotheses: [
    {
      id: "usall-h1",
      statement: "The United States response is primarily alliance-management through private diplomatic coordination rather than public rupture.",
      rationale: "Washington often manages allied political divergence through consultations, reassurance, and issue-specific coordination before escalating publicly.",
      priority: "high",
      domain: "geopolitics",
      disconfirmingSignals: [
        "White House or State Department issues unusually sharp public criticism",
        "US Congress advances punitive alliance or burden-sharing measures",
        "Defense or intelligence cooperation is visibly suspended"
      ]
    },
    {
      id: "usall-h2",
      statement: "The United States will publicly amplify concern if Seoul's China, North Korea, or Russia posture is judged to weaken alliance commitments.",
      rationale: "Public concern becomes more likely when rhetoric turns into policy affecting sanctions, deterrence, technology security, or trilateral cooperation.",
      priority: "high",
      domain: "geopolitics",
      disconfirmingSignals: [
        "US officials reaffirm alliance continuity without caveats",
        "No policy change follows campaign or media rhetoric",
        "Joint exercises and trilateral coordination continue normally"
      ]
    },
    {
      id: "usall-h3",
      statement: "The reported pro-China or anti-US framing is overstated, so the US reaction remains limited and procedural.",
      rationale: "Domestic political framing can overstate policy divergence; actual US reaction may stay limited if official commitments remain unchanged.",
      priority: "medium",
      domain: "geopolitics",
      disconfirmingSignals: [
        "Multiple independent US sources identify concrete alliance friction",
        "Official documents cite China, North Korea, or Russia policy divergence",
        "Market, defense, or diplomatic actions show measurable repricing of alliance risk"
      ]
    }
  ],
  searchPlan: [
    {
      id: "usall-s1",
      query: "Lee Jae-myung foreign policy China North Korea Russia United States response alliance",
      purpose: "Collect international reporting on the US response to South Korea foreign-policy positioning.",
      sourceTypes: ["news", "official-statement", "analysis"],
      tags: ["south-korea", "united-states", "alliance", "foreign-policy"]
    },
    {
      id: "usall-s2",
      query: "US State Department South Korea Lee Jae-myung China Russia North Korea alliance response",
      purpose: "Check official US government framing and whether Washington has issued public concern.",
      sourceTypes: ["official-statement", "news", "congressional-record"],
      tags: ["state-department", "white-house", "congress", "alliance"]
    },
    {
      id: "usall-s3",
      query: "이재명 북중러 친중 반미 정책 미국 반응 한미동맹",
      purpose: "Collect Korean-language coverage and compare it against US official and foreign-media reporting.",
      sourceTypes: ["news", "official-statement", "analysis"],
      tags: ["이재명", "미국", "한미동맹", "친중", "반미", "북중러"]
    },
    {
      id: "usall-s4",
      query: "South Korea US alliance China policy Reuters BBC CNN Fox KBS SBS MBC JTBC",
      purpose: "Force source diversity across major international and Korean outlets.",
      sourceTypes: ["news"],
      tags: ["source-diversity", "reuters", "bbc", "cnn", "fox", "korean-media"]
    }
  ]
};

const CLAIM_VERIFICATION_TEMPLATE: ScenarioTemplate = {
  scenario: "claim_verification",
  domain: "geopolitics",
  title: "Geopolitical Claim Verification Plan",
  hypotheses: [
    {
      id: "cv-h1",
      statement: "The claim is supported by verifiable official policy, party documents, or multiple independent primary sources.",
      rationale: "Extraordinary geopolitical claims require primary-source confirmation before they can be treated as plausible.",
      priority: "high",
      domain: "geopolitics",
      disconfirmingSignals: [
        "No official Japanese government or LDP document states the alleged plan",
        "Major independent media do not corroborate the claim",
        "The named operational vehicle is fictional, satirical, or misattributed"
      ]
    },
    {
      id: "cv-h2",
      statement: "The claim is unsupported or false, likely mixing fiction, rumor, or online speculation with real political names.",
      rationale: "Claims involving secret invasion or territorial restoration plans often spread through narrative conflation unless primary evidence exists.",
      priority: "high",
      domain: "geopolitics",
      disconfirmingSignals: [
        "Authenticated documents or recordings independently confirm the plan",
        "Japanese government, party, or allied official sources acknowledge the policy",
        "Multiple reputable outlets publish independently sourced evidence"
      ]
    },
    {
      id: "cv-h3",
      statement: "The claim exaggerates or misreads real Japanese security debate without evidence of an operational plan.",
      rationale: "Defense policy debates can be distorted into claims of offensive plans; separating rhetoric from operational evidence is required.",
      priority: "medium",
      domain: "security",
      disconfirmingSignals: [
        "The alleged plan appears in formal budget, doctrine, deployment, or party platform language",
        "Operational preparations are observable and linked to the alleged objective",
        "Official denials are contradicted by primary-source records"
      ]
    }
  ],
  searchPlan: [
    {
      id: "cv-s1",
      query: "Takaichi LDP VIVANT Korea reoccupation Manchuria restoration claim verification",
      purpose: "Search broad public reporting for the exact claim and whether reputable outlets corroborate it.",
      sourceTypes: ["news", "fact-check", "analysis"],
      tags: ["claim-verification", "takaichi", "ldp", "vivant", "korea", "manchuria"]
    },
    {
      id: "cv-s2",
      query: "Japan official Takaichi LDP Korea policy Manchuria VIVANT",
      purpose: "Prioritize official Japanese government and LDP sources for primary-source confirmation or absence.",
      sourceTypes: ["official-statement", "party-platform", "policy-document"],
      tags: ["official", "japan", "ldp", "policy"]
    },
    {
      id: "cv-s3",
      query: "高市 自民党 VIVANT 朝鮮半島 満州 回復 計画 検証",
      purpose: "Search Japanese-language sources for the original wording and potential rumor lineage.",
      sourceTypes: ["news", "official-statement", "fact-check"],
      tags: ["japanese-language", "claim-verification", "rumor-lineage"]
    },
    {
      id: "cv-s4",
      query: "다카이치 자민당 비반트 한반도 재점령 만주수복 계획 사실 여부",
      purpose: "Search Korean-language reporting and community-derived phrasing while separating evidence from repetition.",
      sourceTypes: ["news", "fact-check", "analysis"],
      tags: ["korean-language", "claim-verification", "source-lineage"]
    }
  ]
};

const GENERIC_SECURITY_TEMPLATE: ScenarioTemplate = {
  scenario: "generic_security",
  domain: "security",
  title: "Generic Security Investigation Plan",
  hypotheses: [
    {
      id: "sec-h1",
      statement: "The reported issue reflects a credible security threat with aligned actor capability, intent, and opportunity.",
      rationale: "A security assessment should test whether capability and intent are both present before escalating confidence.",
      priority: "high",
      domain: "security",
      disconfirmingSignals: [
        "Actor capability is unverified",
        "Intent indicators are absent or contradicted",
        "The timing is better explained by routine activity"
      ]
    },
    {
      id: "sec-h2",
      statement: "The observed activity is routine, accidental, or misreported rather than a deliberate security threat.",
      rationale: "Baseline comparison and source reliability checks prevent over-interpreting ambiguous signals.",
      priority: "medium",
      domain: "security",
      disconfirmingSignals: [
        "Multiple independent sources report abnormal activity",
        "Official alerts or defensive measures are issued",
        "The activity deviates from established baseline patterns"
      ]
    },
    {
      id: "sec-h3",
      statement: "A third-party, environmental, or policy driver explains the observed risk better than direct hostile action.",
      rationale: "Security events can be shaped by indirect drivers such as regulation, accidents, local politics, or infrastructure failure.",
      priority: "medium",
      domain: "geopolitics",
      disconfirmingSignals: [
        "No plausible third-party or environmental trigger is present",
        "Threat actor communications claim responsibility",
        "Operational signatures match known hostile tradecraft"
      ]
    }
  ],
  searchPlan: [
    {
      id: "sec-s1",
      query: "security threat indicators actor capability intent opportunity public sources",
      purpose: "Collect public-source evidence on capability, intent, and opportunity.",
      sourceTypes: ["news", "official-statement", "analysis"],
      tags: ["security", "threat", "capability", "intent"]
    },
    {
      id: "sec-s2",
      query: "security incident baseline routine activity false report",
      purpose: "Compare the reported issue against routine baselines and false-positive explanations.",
      sourceTypes: ["news", "official-statement", "historical-data"],
      tags: ["security", "baseline", "false-positive"]
    },
    {
      id: "sec-s3",
      query: "regional security risk third party driver policy infrastructure",
      purpose: "Check whether indirect drivers explain the risk better than hostile action.",
      sourceTypes: ["analysis", "news", "official-statement"],
      tags: ["security", "geopolitics", "drivers"]
    }
  ]
};
