# Defense PoC Use Cases

## 1. Supply Chain Disruption Analysis

Question:

> 핵심 부품 수입 급감의 원인을 여러 가설로 분석하고, 추가 확인이 필요한 RFI를 제안한다.

WARDEN fit:

- ACH로 경쟁 가설을 비교한다.
- SourceVet으로 출처 신뢰도와 독립 검증을 확인한다.
- 외부 OSINT fetch는 approval pending으로 남긴다.
- HTML report로 비개발 검토자가 결과를 확인한다.

## 2. RFI Triage And Evidence Discipline

Question:

> 수요기업 또는 분석팀이 제기한 RFI 후보를 근거, 출처, 위험도 기준으로 정렬한다.

WARDEN fit:

- Evidence Curator가 claim을 KnowledgeUnit으로 정규화한다.
- Policy Reviewer가 외부 조회와 위험 작업을 분리한다.
- Verifier가 누락된 reliability, incomplete matrix, trace gap을 잡는다.

## 3. Controlled AI Assistant For Sensitive Analysis

Question:

> 내부 분석자가 AI 보조를 쓰되, AI가 무단으로 외부 호출하거나 판단값을 덮어쓰지 않게 한다.

WARDEN fit:

- LLM output is proposal-only.
- no silent external call regression이 존재한다.
- raw model tool call과 ACH authority override를 차단한다.

## Suggested Partner Keywords

- 방산 공급망
- RFI watch
- OSINT governance
- 분석 감사 로그
- 출처 신뢰도 검증
- 승인형 AI agent
- offline-first AI workflow
- controlled multi-agent harness
