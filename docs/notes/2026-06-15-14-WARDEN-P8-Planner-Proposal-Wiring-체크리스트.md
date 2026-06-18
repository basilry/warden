---
type: phase-checklist
date: 2026-06-15
project: 02021-warden-agents
phase: P8
subject: WARDEN P8 Planner Proposal Wiring 체크리스트
tags:
  - project
  - WARDEN
  - phase
  - checklist
  - planner
  - runtime
  - tool-routing
  - 방산
status: implemented
related:
  - "[[2026-06-15-06-WARDEN-멀티에이전트-팀-WBS]]"
  - "[[2026-06-15-13-WARDEN-P7-실사용-답변엔진-체크리스트]]"
---

# WARDEN P8 Planner Proposal Wiring 체크리스트

## 목표

P8의 목표는 Codex/LLM planner output을 raw execution으로 쓰지 않고, **검증된 tool plan 후보**로만 반영하는 것이다.

## 현재 구현 상태

- `src/runtime/tool-plan-schema.ts`에 `RuntimePlannerProposal` parser/validator를 추가했다.
- `src/runtime/planner.ts`에 `selectRuntimeToolPlan()`과 deterministic fallback을 분리했다.
- `src/runtime/loop.ts`가 모델 proposal을 받아 schema, allowlist, capability, blocked-risk 검증 후 `RoutedToolCall`로 승격한다.
- invalid proposal은 deterministic fallback으로 돌아간다.
- selection source와 warning은 `mcp.tool_start` event에 남는다.
- `demo/run-warden-planner-regression.ts`와 `npm test`에 포함했다.

## 생성 파일

| 파일 | 상태 | 목적 |
|---|---:|---|
| `src/runtime/planner.ts` | 완료 | model proposal 기반 tool plan selection |
| `src/runtime/tool-plan-schema.ts` | 완료 | proposal schema/type guard |
| `demo/run-warden-planner-regression.ts` | 완료 | planner wiring regression |

## 수정 파일

| 파일 | 상태 | 수정 내용 |
|---|---:|---|
| `src/runtime/loop.ts` | 완료 | `selectRuntimeToolPlan()` 사용, event에 planner source/warning 기록 |
| `src/agent/models/mock-model.ts` | 완료 | valid planner proposal fixture 추가 |
| `package.json` | 완료 | `demo:warden:planner` 및 `npm test` 연결 |
| `src/agent/security/output-validator.ts` | 유지 | 기존 raw tool execution 금지 회귀로 검증 |

## 체크리스트

### P8.0 Schema

- [x] `RuntimePlannerProposal` 타입 정의
- [x] proposal type guard/parser 구현
- [x] invalid JSON fallback
- [x] missing field fallback
- [x] unsupported risk reject/fallback

### P8.1 Selection

- [x] `selectRuntimeToolPlan()` 구현
- [x] iteration별 deterministic fallback 유지
- [x] valid model proposal -> `RoutedToolCall`
- [x] unknown tool -> fallback
- [x] policy-change/destructive -> fallback 및 warning
- [x] selection warning trace 기록

### P8.2 Policy/MCP Boundary

- [x] router allowlist 확인
- [x] capability allowlist 확인
- [x] raw model tool execution 금지 유지
- [x] `routeToolCallWithPolicy()` 경유 보장
- [x] approval required path 유지

### P8.3 Regression

- [x] valid planner proposal 반영
- [x] invalid JSON fallback
- [x] unknown tool fallback
- [x] destructive proposal fallback
- [x] raw tool call 문자열 무시
- [x] `npm test`에 포함

## 검증

- [x] `npm run demo:warden:planner`
- [x] `npm test`

## 남은 리스크

- planner proposal input schema는 아직 tool별 상세 Zod/JSON schema가 아니다.
- iteration 1에서 모델이 external tool을 제안해도 policy가 막지만, planner strategy 자체는 아직 단순하다.
