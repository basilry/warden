const DISPLAY_TRANSLATIONS: ReadonlyArray<[string, string]> = [
  [
    "A near-term Taiwan invasion window is being prepared through PLA mobilization, amphibious lift, missile activity, and civil-military logistics signals.",
    "PLA 동원, 상륙 수송, 미사일 활동, 민군 물류 신호를 통해 근시일 대만 침공 창이 준비되고 있다."
  ],
  [
    "Observed activity is coercive gray-zone pressure or exercise signaling rather than imminent invasion preparation.",
    "관측 활동은 임박한 침공 준비보다 강압적 회색지대 압박 또는 훈련 신호에 가깝다."
  ],
  [
    "A blockade, quarantine, or missile coercion pathway is more plausible than a full amphibious invasion.",
    "전면 상륙 침공보다 봉쇄, 검역, 미사일 강압 경로가 더 개연성 높다."
  ],
  [
    "Korea and Northeast Asia exposure is driven by concentrated upstream inputs for semiconductors, batteries, or defense electronics.",
    "한국과 동북아 노출은 반도체, 배터리, 방산 전자 부문의 상류 투입재 집중에서 비롯된다."
  ],
  [
    "The primary risk is regional logistics interruption across ports, shipping lanes, or customs processes.",
    "주요 리스크는 항만, 해운로, 통관 절차의 지역 물류 차질이다."
  ],
  [
    "The issue is demand or inventory normalization rather than a structural supply-chain shock.",
    "해당 이슈는 구조적 공급망 충격보다 수요 또는 재고 정상화일 가능성이 있다."
  ],
  [
    "New or tightened sanctions and export controls materially constrain the target actor's access to controlled goods or finance.",
    "신규 또는 강화된 제재와 수출통제가 대상 행위자의 통제 품목 또는 금융 접근을 실질적으로 제약한다."
  ],
  [
    "Evasion, substitution, or third-country routing is offsetting the intended pressure.",
    "우회, 대체, 제3국 경유가 의도된 압박 효과를 상쇄하고 있다."
  ],
  [
    "The policy change is primarily signaling and has limited near-term operational effect.",
    "정책 변화는 주로 신호 발신 성격이며 단기 운영 효과는 제한적이다."
  ],
  [
    "The United States response is primarily alliance-management through private diplomatic coordination rather than public rupture.",
    "미국의 반응은 공개 충돌보다 비공개 외교 조율을 통한 동맹 관리에 가까울 가능성이 크다."
  ],
  [
    "The United States will publicly amplify concern if Seoul's China, North Korea, or Russia posture is judged to weaken alliance commitments.",
    "미국은 한국의 중국·북한·러시아 관련 노선이 동맹 공약을 약화한다고 판단할 경우 공개 우려를 증폭할 가능성이 있다."
  ],
  [
    "The reported pro-China or anti-US framing is overstated, so the US reaction remains limited and procedural.",
    "보도된 친중 또는 반미 프레임이 과장되어 미국 반응은 제한적이고 절차적인 수준에 머물 가능성이 있다."
  ],
  [
    "The claim is supported by verifiable official policy, party documents, or multiple independent primary sources.",
    "해당 주장은 검증 가능한 공식 정책, 정당 문서, 또는 복수 독립 1차 출처로 뒷받침된다."
  ],
  [
    "The claim is unsupported or false, likely mixing fiction, rumor, or online speculation with real political names.",
    "해당 주장은 근거가 없거나 허위이며, 실제 정치 인명과 픽션·루머·온라인 추측이 섞였을 가능성이 있다."
  ],
  [
    "The claim exaggerates or misreads real Japanese security debate without evidence of an operational plan.",
    "해당 주장은 실제 일본 안보 논의를 과장 또는 오독했지만 작전계획 근거는 부족할 가능성이 있다."
  ],
  [
    "The reported issue reflects a credible security threat with aligned actor capability, intent, and opportunity.",
    "보고된 사안은 행위자의 역량, 의도, 기회가 맞물린 신뢰 가능한 안보 위협을 반영한다."
  ],
  [
    "The observed activity is routine, accidental, or misreported rather than a deliberate security threat.",
    "관측 활동은 의도적 안보 위협보다 통상 활동, 사고, 또는 오보일 가능성이 있다."
  ],
  [
    "A third-party, environmental, or policy driver explains the observed risk better than direct hostile action.",
    "관측 리스크는 직접 적대행동보다 제3자, 환경, 또는 정책 요인으로 더 잘 설명된다."
  ],
  [
    "Taiwan security pressure can disrupt Northeast Asia semiconductor supply through foundry capacity, advanced packaging schedules, shipping lanes, and export-control coordination.",
    "대만 안보 압박은 파운드리 생산능력, 첨단 패키징 일정, 해운로, 수출통제 공조를 통해 동북아 반도체 공급을 흔들 수 있다."
  ],
  [
    "A Taiwan contingency should be modeled as a combined security, logistics, insurance, and production-planning shock rather than as a single factory outage.",
    "대만 유사시는 단일 공장 중단이 아니라 안보, 물류, 보험, 생산계획이 결합된 충격으로 모델링해야 한다."
  ],
  [
    "Northeast Asia supply-chain analysis should separate upstream materials, precision equipment, fabrication capacity, packaging, ports, and technology-control exposure.",
    "동북아 공급망 분석은 상류 소재, 정밀장비, 제조역량, 패키징, 항만, 기술통제 노출을 분리해서 봐야 한다."
  ],
  [
    "South Korea, Japan, Taiwan, and China form overlapping industrial networks, so resilience work should compare alternate suppliers, buffer inventory, and route substitution.",
    "한국, 일본, 대만, 중국은 중첩된 산업망을 이루므로 회복탄력성 점검은 대체 공급처, 완충 재고, 경로 대체를 비교해야 한다."
  ],
  [
    "Security stress near Taiwan or adjacent sea lanes can raise insurance friction, reroute shipping, and delay high-value electronics components moving through Northeast Asia.",
    "대만 또는 인접 해상로의 안보 긴장은 보험 마찰, 선박 우회, 동북아 고부가 전자부품 운송 지연을 유발할 수 있다."
  ],
  [
    "Useful local indicators include port delays, shipping schedule changes, insurance cost shifts, and public statements about alternate logistics routes.",
    "유용한 현지 지표에는 항만 지연, 선박 일정 변화, 보험 비용 변동, 대체 물류 경로 관련 공개 발언이 포함된다."
  ],
  [
    "Battery and critical-minerals exposure should be split into mining, refining, precursor materials, cell production, and policy controls on exports or subsidies.",
    "배터리와 핵심광물 노출은 채굴, 정련, 전구체 소재, 셀 생산, 수출 또는 보조금 정책통제로 나누어 봐야 한다."
  ],
  [
    "For Northeast Asia supply-chain questions, critical-minerals checks should cover supplier concentration, stockpiles, long-term offtake agreements, and substitute materials.",
    "동북아 공급망 질문에서 핵심광물 점검은 공급자 집중도, 비축량, 장기 구매계약, 대체 소재를 포함해야 한다."
  ],
  ["PLA activity remains within routine exercise bounds", "PLA 활동이 통상 훈련 범위 안에 머문다"],
  ["No unusual roll-on/roll-off ferry or amphibious logistics activation", "비정상적인 Ro-Ro 선박 또는 상륙 물류 활성화가 없다"],
  ["Taiwan civil defense and allied posture show no abnormal alerting", "대만 민방위와 동맹 태세에 비정상 경보가 없다"],
  ["Sustained logistics staging exceeds prior exercise baselines", "지속적 물류 집결이 과거 훈련 기준선을 넘어선다"],
  ["Civil maritime assets are requisitioned for military support", "민간 해상 자산이 군 지원에 징발된다"],
  ["Leadership messaging shifts from deterrence to operational necessity", "지도부 메시지가 억제에서 작전 필요성으로 이동한다"],
  ["Landing craft, airborne, and logistics indicators dominate naval interdiction indicators", "상륙정, 공수, 물류 지표가 해상 차단 지표보다 우세하다"],
  ["Commercial shipping disruption remains absent", "상업 해운 차질이 관측되지 않는다"],
  ["Missile and naval exercises de-escalate quickly", "미사일 및 해군 훈련이 빠르게 완화된다"],
  ["Multiple qualified suppliers are available across jurisdictions", "여러 관할권에 적격 공급자가 존재한다"],
  ["Inventory and substitution capacity cover plausible disruption windows", "재고와 대체 역량이 그럴듯한 차질 기간을 커버한다"],
  ["No evidence of supplier concentration in the target sector", "대상 부문의 공급자 집중 근거가 없다"],
  ["Freight rates and port dwell times remain normal", "운임과 항만 체류 시간이 정상 범위에 머문다"],
  ["Affected firms report production rather than logistics constraints", "영향 기업들이 물류보다 생산 제약을 보고한다"],
  ["Alternative routes are already absorbing volume", "대체 경로가 이미 물량을 흡수하고 있다"],
  ["Demand indicators remain stable while input delays worsen", "수요 지표는 안정적인데 투입재 지연은 악화된다"],
  ["Regulatory or geopolitical triggers align with the disruption", "규제 또는 지정학 촉발 요인이 차질과 맞물린다"],
  ["Multiple unrelated sectors report synchronized bottlenecks", "무관한 여러 부문에서 동시 병목이 보고된다"],
  ["No new designation, licensing, or control-list change is confirmed", "신규 지정, 라이선스, 통제목록 변경이 확인되지 않는다"],
  ["Target import or financing channels remain stable", "대상 수입 또는 금융 채널이 안정적으로 유지된다"],
  ["Suppliers report no compliance-driven change", "공급자들이 컴플라이언스 기인 변화를 보고하지 않는다"],
  ["Transit-country flows do not increase after controls", "통제 이후 경유국 흐름이 증가하지 않는다"],
  ["Substitute suppliers lack the required capability", "대체 공급자가 필요한 역량을 갖추지 못했다"],
  ["Enforcement actions disrupt suspected channels", "집행 조치가 의심 채널을 차단한다"],
  ["Licensing denials or seizures occur immediately", "라이선스 거부 또는 압류가 즉시 발생한다"],
  ["Market prices or delivery times move sharply", "시장 가격 또는 납기가 급격히 움직인다"],
  ["Firms publicly suspend affected transactions", "기업들이 영향 거래를 공개적으로 중단한다"],
  ["Actor capability is unverified", "행위자 역량이 검증되지 않았다"],
  ["Intent indicators are absent or contradicted", "의도 지표가 없거나 상충한다"],
  ["The timing is better explained by routine activity", "시점은 통상 활동으로 더 잘 설명된다"],
  ["Multiple independent sources report abnormal activity", "복수 독립 출처가 이상 활동을 보고한다"],
  ["Official alerts or defensive measures are issued", "공식 경보 또는 방어 조치가 발령된다"],
  ["The activity deviates from established baseline patterns", "활동이 기존 기준선 패턴에서 벗어난다"],
  ["No plausible third-party or environmental trigger is present", "그럴듯한 제3자 또는 환경 촉발 요인이 없다"],
  ["Threat actor communications claim responsibility", "위협 행위자 통신이 책임을 주장한다"],
  ["Operational signatures match known hostile tradecraft", "작전 흔적이 알려진 적대적 기법과 일치한다"],
  ["Baseline: pressure stays below event threshold", "기준선: 압박이 사건 임계치 아래에 머문다"],
  ["Coercive escalation without forecast event", "예측 사건 전 단계의 강압적 고조"],
  ["Large-scale Taiwan invasion attempt", "대만 대규모 침공 시도"],
  ["Forecast event occurs", "예측 사건 발생"],
  ["No decisive warning indicators dominate the estimate.", "추정을 지배하는 결정적 경보 지표가 없다."],
  ["Crisis communications remain active.", "위기 소통 채널이 유지된다."],
  ["No broad national mobilization order appears.", "광범위한 국가 동원 명령이 나타나지 않는다."],
  ["Forward deployments remain exercise-sized or reversible.", "전방 배치는 훈련 규모 또는 되돌릴 수 있는 수준에 머문다."],
  ["Expanded exercises or exclusion zones around the target area.", "대상 지역 주변 훈련 또는 통제 구역이 확대된다."],
  ["Cyber, information, or economic pressure increases.", "사이버, 정보, 경제 압박이 증가한다."],
  ["Diplomatic signaling leaves space for de-escalation.", "외교 신호가 긴장 완화 여지를 남긴다."],
  ["Large-scale logistics, sealift, airlift, or medical mobilization becomes visible.", "대규모 물류, 해상수송, 공중수송, 의료 동원이 가시화된다."],
  ["Political leadership accepts high economic and military costs.", "정치 지도부가 높은 경제 및 군사 비용을 감수한다."],
  ["Operational deployments become hard to reverse.", "작전 배치가 되돌리기 어려운 상태가 된다."],
  ["Base-rate risk remains even without strong warning indicators.", "강한 경보 지표가 없어도 기준확률 리스크는 남아 있다."],
  ["ADIZ sortie tempo", "방공식별구역 출격 빈도"],
  ["Amphibious and sealift mobilization", "상륙 및 해상수송 동원"],
  ["Maritime exclusion or exercise zone notice", "해상 통제 또는 훈련 구역 공지"],
  ["Missile or live-fire exercise notice", "미사일 또는 실사격 훈련 공지"],
  ["Vessel inspection or boarding activity", "선박 검문 또는 승선 활동"],
  ["Irreversible mobilization or logistics movement", "비가역적 동원 또는 물류 이동"],
  ["Crisis channels and deterrence signals remain active", "위기 채널과 억제 신호가 유지된다"],
  ["Market, logistics, or insurance friction increases", "시장, 물류, 보험 마찰이 증가한다"],
  ["Mobilization and logistics posture", "동원 및 물류 태세"],
  ["Deterrence and crisis-control signals", "억제 및 위기관리 신호"],
  ["People's Republic of China government", "중국 정부"],
  ["PLA Eastern Theater Command", "중국 인민해방군 동부전구"],
  ["Taiwan Ministry of National Defense", "대만 국방부"],
  ["Taiwan Coast Guard Administration", "대만 해경"],
  ["Taiwan Semiconductor Manufacturing Company", "TSMC"],
  ["United States Department of Defense", "미국 국방부"],
  ["Japan Ministry of Defense", "일본 방위성"],
  ["no scenario templates matched the query", "질의와 일치하는 시나리오 템플릿이 없습니다"],
  ["No local evidence units were available for indicator observation.", "지표 관찰에 사용할 로컬 근거 단위가 없습니다."],
  ["Forecast question is based on deterministic investigation fallback.", "예측 질문은 규칙 기반 대체 분석계획에서 생성되었습니다."],
  [
    "Probability is a bounded analytic estimate and must not be treated as a factual prediction.",
    "확률은 제한된 분석 추정치이며 사실 예측으로 취급하면 안 됩니다."
  ],
  [
    "live Codex output is treated as a proposal, never as execution authority",
    "Codex 실시간 출력은 실행 권한이 아니라 제안으로만 취급됩니다"
  ],
  ["live model output is treated as a proposal, never as execution authority", "실시간 모델 출력은 실행 권한이 아니라 제안으로만 취급됩니다"],
  ["mock model output is a proposal, not an execution authority", "mock 모델 출력은 실행 권한이 아니라 제안입니다"],
  ["dry-run only: codex exec was not launched", "dry-run 모드라 codex exec를 실행하지 않았습니다"],
  [
    "Codex OAuth/API-key credentials are handled by the Codex CLI; WARDEN only forwards process.env",
    "Codex OAuth/API 키 자격증명은 Codex CLI가 관리하며 WARDEN은 process.env만 전달합니다"
  ],
  [
    "This is a deterministic local fixture for grounding and regression tests.",
    "이 항목은 도메인 근거화와 회귀 테스트를 위한 규칙 기반 로컬 고정 데이터입니다."
  ],
  [
    "It is not live OSINT and must not be presented as current external evidence.",
    "실시간 OSINT가 아니며 현재 외부 근거로 제시하면 안 됩니다."
  ],
  ["It is not live OSINT and must not be presented as current evidence.", "실시간 OSINT가 아니며 현재 근거로 제시하면 안 됩니다."],
  [
    "Claims are intentionally generic and should be refreshed by approved retrieval before operational use.",
    "주장은 의도적으로 일반화되어 있으므로 운영 활용 전 승인된 검색으로 갱신해야 합니다."
  ],
  [
    "P0/P2 fixture 기반 분석이므로 실제 데이터 연결 전에는 운영 결론으로 승격하지 않는다.",
    "P0/P2 로컬 고정 데이터 기반 분석이므로 실제 데이터 연결 전에는 운영 결론으로 승격하지 않습니다."
  ],
  ["model proposal validation error", "모델 제안 검증 오류"],
  ["model proposal validation warning", "모델 제안 검증 주의"],
  ["deterministic fallback validation error", "규칙 기반 대체 계획 검증 오류"],
  ["deterministic fallback validation warning", "규칙 기반 대체 계획 검증 주의"],
  ["planner proposal missing or invalid; using deterministic fallback.", "플래너 제안이 없거나 유효하지 않아 규칙 기반 대체 계획을 사용했습니다."],
  ["planner proposal contains an empty required field; using deterministic fallback.", "플래너 제안의 필수 필드가 비어 있어 규칙 기반 대체 계획을 사용했습니다."]
];

export function translateDisplayKo(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  const codexStderr = /^codex stderr:\s*(.+)$/s.exec(trimmed);
  if (codexStderr) {
    return `Codex CLI 진단 로그: ${summarizeDiagnosticText(codexStderr[1])}`;
  }

  const escalation = /^Corroborate escalation signal:\s*(.+)\.$/.exec(trimmed);
  if (escalation) {
    return `상승 신호 교차확인: ${translateDisplayKo(escalation[1])}.`;
  }

  const disconfirming = /^Corroborate disconfirming signal:\s*(.+)\.$/.exec(trimmed);
  if (disconfirming) {
    return `반증 신호 교차확인: ${translateDisplayKo(disconfirming[1])}.`;
  }

  const strengthens = /^Corroborated evidence strengthens:\s*(.+)\.$/.exec(trimmed);
  if (strengthens) {
    return `확인된 근거가 추정을 높임: ${translateDisplayKo(strengthens[1])}.`;
  }

  const weakens = /^Corroborated evidence weakens or reverses:\s*(.+)\.$/.exec(trimmed);
  if (weakens) {
    return `확인된 근거가 추정을 낮추거나 뒤집음: ${translateDisplayKo(weakens[1])}.`;
  }

  let translated = trimmed;
  for (const [source, target] of DISPLAY_TRANSLATIONS) {
    translated = translated.split(source).join(target);
  }
  return translated;
}

export function formatHypothesisKo(value: string): string {
  return translateDisplayKo(value);
}

export function formatDomainKo(domain: string | undefined): string {
  if (!domain) return "알 수 없음";
  if (domain === "defense_supply_chain") return "방산/전략 공급망";
  if (domain === "supply_chain") return "공급망";
  if (domain === "economic_security") return "경제안보";
  if (domain === "geopolitics") return "지정학";
  if (domain === "defense") return "국방";
  if (domain === "security") return "안보";
  if (domain === "mixed") return "복합";
  return translateDisplayKo(domain);
}

export function formatScenarioKo(scenario: string | undefined): string {
  if (!scenario || scenario === "none") return "없음";
  if (scenario === "taiwan_invasion") return "대만 침공 리스크";
  if (scenario === "korea_northeast_asia_supply_chain") return "한국/동북아 공급망";
  if (scenario === "sanctions_export_controls") return "제재 및 수출통제";
  if (scenario === "us_alliance_response") return "미국/동맹 반응";
  if (scenario === "claim_verification") return "주장 검증";
  if (scenario === "generic_security") return "일반 안보";
  return translateDisplayKo(scenario);
}

export function formatPlanSourceKo(source: string | undefined): string {
  if (!source) return "알 수 없음";
  if (source === "model_proposal") return "모델 제안";
  if (source === "deterministic_fallback") return "규칙 기반 대체 계획";
  return translateDisplayKo(source);
}

export function formatConfidenceKo(confidence: string | undefined): string {
  if (confidence === "high") return "높음";
  if (confidence === "medium") return "중간";
  if (confidence === "low") return "낮음";
  return confidence ? translateDisplayKo(confidence) : "알 수 없음";
}

export function formatDirectionKo(direction: string | undefined): string {
  if (direction === "raises") return "상승 신호";
  if (direction === "lowers") return "하락 신호";
  return direction ? translateDisplayKo(direction) : "방향 미상";
}

export function formatUrgencyKo(urgency: string | undefined): string {
  if (urgency === "near_term") return "단기";
  if (urgency === "monitor") return "관찰";
  if (urgency === "background") return "배경";
  return urgency ? translateDisplayKo(urgency) : "관찰";
}

export function formatRiskKo(risk: string | undefined): string {
  if (risk === "READ") return "읽기";
  if (risk === "WRITE") return "쓰기";
  if (risk === "EXTERNAL") return "외부";
  if (risk === "DESTRUCTIVE") return "파괴적";
  if (risk === "POLICY_CHANGE") return "정책 변경";
  return risk ? translateDisplayKo(risk) : "미상";
}

export function formatHorizonKo(label: string | undefined, months: number | undefined): string {
  if (label === "next 12 months") return "향후 12개월";
  if (months !== undefined) return `${months}개월`;
  return label ? translateDisplayKo(label) : "예측 기간";
}

export function formatSourceKindKo(sourceKind: string | undefined): string {
  if (!sourceKind) return "출처";
  if (sourceKind === "rag") return "로컬 RAG";
  if (sourceKind === "fixture") return "로컬 고정 데이터";
  if (sourceKind === "live-osint") return "실시간 OSINT";
  return translateDisplayKo(sourceKind);
}

function summarizeDiagnosticText(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return "내용 없음";
  const session = /session id:\s*([a-z0-9-]+)/i.exec(compact)?.[1];
  const model = /model:\s*([^\s]+)/i.exec(compact)?.[1];
  const provider = /provider:\s*([^\s]+)/i.exec(compact)?.[1];
  const parts = [
    model ? `모델 ${model}` : undefined,
    provider ? `제공자 ${provider}` : undefined,
    session ? `세션 ${session}` : undefined
  ].filter((item): item is string => Boolean(item));
  if (parts.length > 0) return parts.join(", ");
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}
