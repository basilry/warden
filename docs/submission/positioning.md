# WARDEN Positioning

## One-Sentence Definition

WARDEN은 방산 조직이 LLM을 직접 신뢰하지 않고도 활용할 수 있도록, 모든 에이전트 실행을 정책, 승인, 결정적 분석, 독립 검증, 감사 로그로 통제하는 offline-first 멀티에이전트 하네스다.

## Elevator Pitch

방산 분석에서 AI의 문제는 답변 품질만이 아니라 통제, 승인, 감사, 재현성 부족이다. WARDEN은 LLM을 판단자가 아니라 제안자와 오케스트레이션 보조자로 제한하고, ACH와 SourceVet 같은 결정적 규율 모듈로 분석과 출처 검증을 고정한다. 외부 호출은 정책 검토와 승인 대기 상태로 남기며, 모든 handoff와 tool call은 감사 리포트와 regression으로 재현된다.

## Differentiation

- Offline-first: 기본 demo와 regression은 네트워크 없이 동작한다.
- Deterministic authority: 핵심 판단값은 ACH, SourceVet, policy, verifier가 만든다.
- Human-approved external action: 외부 호출은 silent execution이 아니라 approval pending으로 처리한다.
- Audit-ready: job history, approval queue, policy decision, trace timeline, report artifact를 남긴다.
- Regression-first: 실패 케이스를 fixture로 고정해 같은 오류가 반복되지 않게 한다.

## Language To Avoid

- "AI가 최종 판단한다"
- "무인 자동 수집/자동 대응"
- "이미 내부망에 적용이 끝났다는 표현"
- "검증되지 않은 인증/감사 통과 주장"
- "확보되지 않은 운영 고객 레퍼런스 주장"

Recommended phrasing:

- "LLM output is proposal-only."
- "External action requires explicit approval."
- "Operational deployment requires partner-specific security review."
