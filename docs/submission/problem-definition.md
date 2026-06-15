# Problem Definition

## Core Problem

방산 조직은 LLM의 분석 능력을 활용하고 싶지만, 실제 업무에서는 다음 요구가 더 중요하다.

- 누가 어떤 근거로 판단했는지 추적되어야 한다.
- 외부 자료 수집과 위험 작업은 명시적 승인을 거쳐야 한다.
- 출처 신뢰도와 순환 인용을 검증해야 한다.
- 같은 입력은 같은 절차와 검증 결과로 재현되어야 한다.
- 모델이 만든 문장과 시스템이 승인한 판단값이 구분되어야 한다.

## Why Existing Chat-First AI Is Not Enough

일반 대화형 AI는 빠른 초안을 만들 수 있지만, 방산 분석 workflow에서 필요한 통제면이 부족하다.

- Tool call과 외부 호출 경계가 흐려질 수 있다.
- 출처 신뢰도와 독립 검증이 결과물 내부에 묻힌다.
- 승인 대기, 반려, 정책 변경 시도가 audit object로 남지 않는다.
- 모델 환각이 결정적 분석값을 덮어쓸 위험이 있다.

## WARDEN Response

WARDEN은 AI 답변 자체를 제품으로 내세우지 않는다. 제품의 핵심은 통제면이다.

- Specialist agents: Case Framer, Evidence Curator, SourceVet, ACH Analyst, Policy Reviewer, Verifier, Briefing
- Deterministic tools: ACH matrix, SourceVet scoring, policy decision, regression checks
- Audit outputs: HTML report, trace timeline, job history, approval queue
- Live boundary: Codex/OpenAI/MCP live paths are opt-in only
