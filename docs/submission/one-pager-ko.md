# WARDEN One-Pager

## 한 줄 설명

WARDEN은 방산 조직이 LLM을 직접 신뢰하지 않고도 활용할 수 있도록, 에이전트 실행을 정책, 승인, 결정적 분석, 독립 검증, 감사 로그로 통제하는 offline-first 멀티에이전트 하네스다.

## 문제

방산 분석에서 AI 도입의 핵심 장애물은 "답변 품질"만이 아니다. 실제 업무에서는 외부 호출 승인, 출처 검증, 감사 가능성, 재현성, 모델 권한 제한이 필요하다.

## 해결 방식

WARDEN은 LLM을 최종 판단자가 아니라 제안자로 제한한다. 분석 판단은 ACH, SourceVet, Policy Reviewer, Verifier 같은 규율 모듈을 거쳐 남는다.

## 핵심 기능

- Supervisor-led specialist team
- ACH 기반 경쟁 가설 분석
- SourceVet 기반 출처 신뢰도 검토
- Policy Reviewer 기반 tool call 사전 검토
- HITL approval queue
- JSONL persistence와 run bundle export/import
- HTML audit report
- SEC regression pack
- Codex CLI/OAuth 경로 dry-run 및 opt-in live mode

## 방산 적용 시나리오

초기 PoC는 "핵심 부품 수입 급감 원인 분석" fixture로 시연한다. WARDEN은 공급망 이상 징후를 여러 가설로 나누고, 출처 검증과 RFI 후보를 감사 가능한 리포트로 묶는다.

## Demo Commands

```bash
npm install
npm run demo:warden:report
npm test
```

Report output:

```text
reports/<runId>/index.html
```

## 현재 구현 수준

Local MVP / 심사용 기술 데모 수준이다. 기본 경로는 offline deterministic demo이며, live model과 MCP 경로는 opt-in 또는 fixture 기반 검증으로 제한되어 있다.

## 협업 요청

수요기업과의 PoC에서는 실제 문서 샘플, 승인 정책, 분석 RFI 유형을 제공받아 WARDEN의 KnowledgeUnit, SourceVet, ACH matrix, approval policy를 조직 환경에 맞게 조정하는 것을 목표로 한다.
