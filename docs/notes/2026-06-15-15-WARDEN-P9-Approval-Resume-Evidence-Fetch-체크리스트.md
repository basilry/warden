---
type: phase-checklist
date: 2026-06-15
project: 02021-warden-agents
phase: P9
subject: WARDEN P9 Approval Resume and Evidence Fetch 체크리스트
tags:
  - project
  - WARDEN
  - phase
  - checklist
  - approval
  - resume
  - evidence
  - OSINT
  - 방산
status: implemented-partial
related:
  - "[[2026-06-15-13-WARDEN-P7-실사용-답변엔진-체크리스트]]"
  - "[[2026-06-15-14-WARDEN-P8-Planner-Proposal-Wiring-체크리스트]]"
---

# WARDEN P9 Approval Resume and Evidence Fetch 체크리스트

## 목표

P9의 목표는 `external_osint_fetch`가 승인 대기에서 끝나지 않고, human approval 이후 같은 run 상태에 근거가 반영되게 하는 것이다.

## 현재 구현 상태

- `src/runtime/approval-actions.ts`에 approve/reject 상태 전환을 추가했다.
- `src/runtime/external-fetch.ts`에 승인된 `external_osint_fetch` 전용 deterministic local fetch fixture를 추가했다.
- `src/runtime/loop.ts`에 `approveRuntimeApproval()`과 `rejectRuntimeApproval()`을 추가했다.
- `src/cli/warden.ts` 대화형 모드에 `/approve`, `/reject`를 추가했다.
- `src/runtime/server.ts`에 `POST /runs/:id/approvals/:approvalId/approve|reject`를 추가했다.
- 승인 후 answer에서 `blockedActions`가 제거되고 `fetchedEvidence`와 `authorityRefs`가 갱신된다.
- 실제 네트워크 OSINT는 아직 실행하지 않는다.

## 생성 파일

| 파일 | 상태 | 목적 |
|---|---:|---|
| `src/runtime/approval-actions.ts` | 완료 | pending approval approve/reject |
| `src/runtime/external-fetch.ts` | 완료 | 승인된 external fetch local fixture |
| `demo/run-warden-approval-resume-regression.ts` | 완료 | approve/reject/resume regression |

## 수정 파일

| 파일 | 상태 | 수정 내용 |
|---|---:|---|
| `src/runtime/types.ts` | 완료 | approval resolved/resume/fetch event, fetched evidence 필드 |
| `src/runtime/loop.ts` | 완료 | approval approve/reject/resume 함수 |
| `src/runtime/server.ts` | 완료 | approval approve/reject endpoint |
| `src/cli/warden.ts` | 완료 | `/approve`, `/reject` 명령 |
| `src/runtime/answer.ts` | 완료 | fetched evidence, blocked action 제거 반영 |
| `package.json` | 완료 | `demo:warden:approval-resume` 및 `npm test` 연결 |

## 체크리스트

### P9.0 Approval Actions

- [x] approval ID를 CLI/JSON/API에 표시
- [x] `/approve <approvalId|toolName>` 구현
- [x] `/reject <approvalId|toolName>` 구현
- [x] rejected approval은 resume하지 않음
- [x] approval decision trace/event 기록

### P9.1 Runtime Resume

- [x] pending approval 상태 저장
- [x] run status `waiting_approval -> running -> succeeded|failed`
- [x] duplicate resume 방지
- [x] resume 중 실패 시 기존 deterministic answer 보존
- [x] runtime event 기록

### P9.2 External Fetch

- [x] approved external fetch stub 구현
- [x] no approval -> fetch 불가 regression
- [x] fetched evidence provenance
- [x] fetched evidence answer 반영
- [ ] fetched evidence redaction 강화
- [ ] SourceVet 재검토
- [ ] ACH 재평가

### P9.3 API/CLI

- [x] HTTP `POST /runs/:id/approvals/:approvalId/approve`
- [x] HTTP `POST /runs/:id/approvals/:approvalId/reject`
- [x] CLI `/approve <approvalId|toolName>`
- [ ] CLI `/resume <runId>` 별도 명령
- [x] `warden run --auto-approve` 미구현 유지

### P9.4 Regression

- [x] no-egress without approval 유지
- [x] approve 후 fetch 실행
- [x] reject 후 fetch 미실행
- [x] resume 후 answer 업데이트
- [x] duplicate approve는 pending selector에서 실패
- [x] `npm test`에 포함

## 검증

- [x] `npm run demo:warden:approval-resume`
- [x] `npm run demo:warden:runtime`
- [x] `npm test`

## 완료 기준 판정

- 승인 전 external action 미실행: 완료
- 승인 후 같은 run 재개 및 answer 업데이트: 완료
- fetched evidence provenance: 완료
- SourceVet/ACH 재평가: 미완료

## 다음 작업

- 승인 후 fetched evidence를 SourceVet reviewer와 ACH analyst에 다시 넣는 `resumeStage=sourcevet|ach` 흐름을 추가해야 한다.
- 실제 OSINT connector는 allowlist, redaction, SourceVet, audit policy가 준비된 뒤 붙인다.
