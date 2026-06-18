---
type: development-plan
date: 2026-06-15
project: 02021-warden-agents
phase: P11
subject: WARDEN P11 SourceVet ACH Resume Integration 개발계획
tags:
  - project
  - WARDEN
  - phase
  - sourcevet
  - ach
  - approval
  - resume
  - 방산
status: implemented-with-followups
related:
  - "[[2026-06-15-15-WARDEN-P9-Approval-Resume-Evidence-Fetch-체크리스트]]"
  - "[[2026-06-15-17-WARDEN-P8-P10-구현-리뷰-및-전체평가]]"
  - "[[2026-06-15-18-WARDEN-ACH-MCP-분리-개발계획]]"
---

# WARDEN P11 SourceVet ACH Resume Integration 개발계획

## 목표

P11의 목표는 승인 후 fetch된 evidence를 단순히 answer에 붙이는 수준에서 끝내지 않고, **SourceVet 검토와 ACH 재평가 루프**에 다시 투입하는 것이다.

현재 상태:

- `/approve` 또는 HTTP approve 후 `fetchedEvidence`가 `RuntimeRun.outputs`에 붙는다.
- answer의 `blockedActions`, `evidenceUsed`, `authorityRefs`는 갱신된다.
- 하지만 SourceVet 재검토와 ACH survivor ranking 재계산은 수행하지 않는다.

P11 완료 후:

- 승인 후 fetch result가 `KnowledgeUnit[]`로 정규화된다.
- SourceVet이 fetched evidence를 검토한다.
- SourceVet 통과 evidence만 EvidenceBundle로 승격된다.
- ACH matrix가 재계산된다.
- answer는 survivor ranking 변경 여부를 명시한다.

## 선행 조건

- P9 approval resume path 완료
- P10 domain grounding 완료
- ACH MCP 분리 완료 또는 최소한 ACH tool invocation abstraction 준비

## 범위

포함:

- fetched `KnowledgeUnit[]` -> SourceVet input
- SourceVet flags -> evidence promotion gate
- fetched evidence -> `EvidenceBundle[]` 변환
- 기존 ACH case 또는 new case 재평가
- answer delta rendering
- regression

제외:

- live OSINT connector
- background worker queue
- multi-run comparative analytics
- full analyst UI

## 생성 파일

| 파일 | 목적 |
|---|---|
| `src/runtime/resume.ts` | approval resume orchestration 분리 |
| `src/runtime/resume-evidence.ts` | fetched KnowledgeUnit -> EvidenceBundle 변환 |
| `src/runtime/answer-delta.ts` | survivor/evidence 변화 요약 |
| `demo/run-warden-sourcevet-ach-resume-regression.ts` | P11 regression |

## 수정 파일

| 파일 | 수정 내용 |
|---|---|
| `src/runtime/loop.ts` | approval resume logic을 `resume.ts`로 이동 |
| `src/runtime/types.ts` | `resumeResult`, `resumeStage`, `achBefore`, `achAfter` 추가 |
| `src/agent/types.ts` | `RunOptions.extraKnowledgeUnits`, `RunOptions.extraEvidenceBundles` 추가 |
| `src/agent/team-runner.ts` | extra evidence를 team workflow에 주입 |
| `src/agent/agents/evidence-curator.ts` | fixture evidence와 extra evidence 병합 |
| `src/agent/agents/sourcevet-reviewer.ts` | fetched evidence review path 강화 |
| `src/runtime/answer.ts` | ranking 변화, SourceVet status, rejected evidence 표시 |
| `package.json` | `demo:warden:sourcevet-ach-resume` 추가 |

## 핵심 타입

```ts
type RuntimeResumeStage =
  | "approval_resolved"
  | "fetch_completed"
  | "sourcevet_completed"
  | "ach_completed"
  | "answer_recomposed";

type RuntimeResumeResult = {
  approvalId: string;
  fetchedUnits: KnowledgeUnit[];
  promotedBundles: EvidenceBundle[];
  rejectedUnits: string[];
  sourceReview?: SourceReview;
  achBefore?: AchAnalysisResult;
  achAfter?: AchAnalysisResult;
  survivorDelta: {
    added: string[];
    removed: string[];
    unchanged: string[];
  };
};
```

## 핵심 함수

- `resumeRuntimeAfterApproval(state, runId, approvalId, deps)`
- `fetchEvidenceForApprovedAction(run, approval)`
- `reviewFetchedEvidenceWithSourceVet(units, context)`
- `promoteSourceVettedUnitsToBundles(units, review)`
- `rerunAchWithPromotedEvidence(run, bundles, context)`
- `calculateSurvivorDelta(before, after)`
- `composeAnswerAfterAchResume(run, resumeResult)`

## 구현 로직

1. approval이 `approved`로 바뀐다.
2. approved action이 `external_osint_fetch`인지 확인한다.
3. fetch provider가 `KnowledgeUnit[]`을 반환한다.
4. SourceVet이 fetched units를 검토한다.
5. high-risk 또는 uncorroborated evidence는 ACH 승격에서 제외한다.
6. 통과한 units를 `EvidenceBundle[]`로 변환한다.
7. 기존 case frame과 기존 evidence + promoted evidence로 ACH를 재실행한다.
8. survivor ranking delta를 계산한다.
9. answer에 다음을 표시한다.
   - 새로 반영된 근거
   - 제외된 근거와 이유
   - survivor ranking 변경
   - 남은 한계

## 체크리스트

### P11.0 Resume Orchestrator

- [x] `src/runtime/resume.ts` 생성
- [x] approval resolve와 fetch 실행 분리
- [x] resume stage event 기록
- [ ] resume 실패 시 기존 answer 보존
- [x] duplicate resume 방지

### P11.1 SourceVet Gate

- [x] fetched units SourceVet input 연결
- [x] source flags를 resume result에 저장
- [x] rejected units 목록 생성
- [x] SourceVet 통과 evidence만 ACH 승격
- [x] SourceVet failure는 ACH rerun 중단

### P11.2 ACH Rerun

- [x] 기존 ACH result를 `achBefore`로 저장
- [x] promoted evidence를 ACH input으로 병합
- [x] ACH matrix completeness 재검증
- [x] `achAfter` 저장
- [x] survivor delta 계산

### P11.3 Answer

- [x] answer에 survivor delta 표시
- [x] answer에 rejected evidence 표시
- [x] answer에 SourceVet status 표시
- [x] pending approval 제거 유지
- [ ] authorityRefs에 `resumeResult`, `sourceReview`, `achAfter` 추가

### P11.4 Regression

- [x] approve 후 SourceVet 실행
- [ ] SourceVet reject evidence는 ACH 미반영
- [x] ACH survivor delta 표시
- [ ] resume 실패 시 기존 answer 유지
- [x] `npm test`에 포함

## 구현 결과 (2026-06-15)

- `approveRuntimeApproval()`이 승인 후 단순 fixture append로 끝나지 않고 `resumeApprovedExternalFetchRun()`으로 SourceVet 검토와 ACH 재평가를 실행한다.
- 최초 team run의 `caseFrame`, `knowledgeUnits`, `evidenceBundles`, `ach`, `sourceReview`가 runtime outputs에 저장된다.
- 승인 후 fetch fixture의 reliability를 Admiralty code(`B2`, `B3`, `A2`)로 맞추고, 자기참조 lineage가 생기지 않도록 claim evidenceRef를 approval-local ref로 변경했다.
- `promoteSourceVettedUnitsToBundles()`가 critical/high SourceVet flag를 승격 차단 기준으로 사용한다.
- `WARDEN_OSINT_LIVE_OPT_IN=true`인 경우 P13 live OSINT provider 결과도 같은 SourceVet/ACH resume path로 들어올 수 있다.
- `demo/run-warden-sourcevet-ach-resume-regression.ts`와 `demo:warden:sourcevet-ach-resume`를 추가해 승인 후 SourceVet, ACH rerun, survivor delta, blocked action 제거를 검증한다.

## 남은 후속작업

- resume 중간 실패 시 기존 answer와 waiting/failed 상태를 더 명확히 보존하는 fallback 경로가 필요하다.
- SourceVet reject evidence가 실제로 ACH에 미반영되는 전용 negative regression이 필요하다.
- authorityRefs에 현재는 `resumeApproval`, `resumePromotedEvidence`, `resumeRejectedEvidence`가 들어가며, 문서의 `sourceReview`, `achAfter` literal ref는 아직 추가하지 않았다.

## 완료 기준

- 승인 후 새 evidence가 answer에 붙는 것만으로 끝나지 않는다.
- SourceVet 통과 evidence만 ACH에 재투입된다.
- ACH survivor 변화가 명시적으로 기록된다.
- 사용자는 “승인 후 무엇이 분석 결과를 바꿨는지” 볼 수 있다.

## 위험과 판단

- 기존 fixture ACH와 domain/retrieved evidence가 섞이면 가설 중복이 생길 수 있다.
- SourceVet 기준이 너무 엄격하면 모든 fetched evidence가 탈락할 수 있다.
- ACH MCP 분리가 먼저 되어 있으면 P11의 권위 경계가 더 깨끗해진다.
