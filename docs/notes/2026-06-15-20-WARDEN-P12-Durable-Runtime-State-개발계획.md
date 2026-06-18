---
type: development-plan
date: 2026-06-15
project: 02021-warden-agents
phase: P12
subject: WARDEN P12 Durable Runtime State 개발계획
tags:
  - project
  - WARDEN
  - phase
  - runtime
  - persistence
  - storage
  - approval
  - 방산
status: implemented-jsonl
related:
  - "[[2026-06-15-17-WARDEN-P8-P10-구현-리뷰-및-전체평가]]"
  - "[[2026-06-15-19-WARDEN-P11-SourceVet-ACH-Resume-Integration-개발계획]]"
---

# WARDEN P12 Durable Runtime State 개발계획

## 목표

P12의 목표는 runtime server와 approval resume 상태를 process memory가 아니라 durable storage에 저장하는 것이다.

현재 상태:

- `RuntimeState`는 `Map<string, RuntimeRun>`이다.
- `warden server`가 재시작되면 run, approval, event 상태가 사라진다.
- 기존 `src/agent/storage/*`에는 jobs, approvals, knowledge, traces, artifacts repository가 있지만 `RuntimeRun` repository는 없다.

P12 완료 후:

- runtime run/event/tool result/approval/output 상태가 JSONL storage에 저장된다.
- server restart 후 `GET /runs/:id`가 가능하다.
- pending approval도 restart 후 approve/reject 가능하다.
- duplicate approval/retry가 idempotent하게 처리된다.

## 범위

포함:

- runtime run repository
- runtime event append log
- startup rehydrate
- approval decision persistence
- JSONL provider 우선 구현
- memory provider parity 유지
- regression

제외:

- production DB migration
- distributed locking
- multi-user auth
- encrypted storage

## 생성 파일

| 파일 | 목적 |
|---|---|
| `src/runtime/storage.ts` | RuntimeRun repository interface |
| `src/runtime/jsonl-runtime-store.ts` | JSONL runtime run persistence |
| `src/runtime/memory-runtime-store.ts` | memory runtime store parity |
| `src/runtime/rehydrate.ts` | server startup state load |
| `demo/run-warden-runtime-persistence-regression.ts` | restart/load/approve regression |

## 수정 파일

| 파일 | 수정 내용 |
|---|---|
| `src/runtime/types.ts` | serializable runtime snapshot 타입 |
| `src/runtime/loop.ts` | state mutation마다 persistence hook 호출 |
| `src/runtime/server.ts` | startup rehydrate, async state 초기화 |
| `src/agent/storage/types.ts` | runtime repository 추가 여부 검토 |
| `src/agent/storage/jsonl-store.ts` | 통합 provider에 runtime repo 추가 또는 runtime 전용 store 연결 |
| `src/agent/config.ts` | runtime persistence config 추가 |
| `package.json` | `demo:warden:runtime-persistence` 추가 |

## 핵심 타입

```ts
type RuntimeRunSnapshot = RuntimeRun;

type RuntimeRepository = {
  saveRun(run: RuntimeRun): Promise<void>;
  loadRun(runId: string): Promise<RuntimeRun | undefined>;
  listRuns(): Promise<RuntimeRun[]>;
  appendEvent(event: RuntimeEvent): Promise<void>;
  listEvents(runId: string): Promise<RuntimeEvent[]>;
};

type PersistentRuntimeState = RuntimeState & {
  repository: RuntimeRepository;
};
```

## 핵심 함수

- `createRuntimeRepository(config)`
- `createPersistentRuntimeState(repository)`
- `saveRuntimeRun(repository, run)`
- `appendRuntimeEvent(repository, event)`
- `rehydrateRuntimeState(repository)`
- `persistApprovalDecision(repository, run)`
- `withRuntimePersistence(deps, repository)`

## 저장 구조 초안

JSONL 기준:

```text
data/runtime/
  runs.jsonl
  events/
    <runId>.jsonl
  approvals.jsonl
  outputs/
    <runId>.json
```

`runs.jsonl`은 같은 run id의 최신 snapshot을 dedupe한다. event는 append-only로 유지한다.

## 구현 로직

1. server 시작 시 config에서 storage root를 읽는다.
2. `rehydrateRuntimeState()`가 latest run snapshots를 Map으로 복원한다.
3. `emit()` 시 event를 append한다.
4. run status/output/toolResults/approvals 변경 시 run snapshot을 save한다.
5. approve/reject endpoint는 run snapshot을 load한 뒤 decision을 적용한다.
6. duplicate approve는 pending approval이 없으면 명확한 409/400 응답을 반환한다.
7. server restart regression에서 pending approval이 유지되는지 확인한다.

## 체크리스트

### P12.0 Repository

- [x] `RuntimeRepository` interface 작성
- [x] memory runtime repository 작성
- [x] JSONL runtime repository 작성
- [x] snapshot dedupe 구현
- [x] event append log 구현

### P12.1 Runtime Integration

- [x] `createRuntimeState()`에 persistence 옵션 추가
- [x] `startRuntimeRun()` snapshot 저장
- [x] `emit()` event 저장
- [x] `executeRuntimeRun()` 완료/실패 저장
- [x] approval approve/reject 저장

### P12.2 Server Rehydrate

- [x] server startup에서 run snapshots 복원
- [x] `GET /runs`가 복원된 run 표시
- [x] `GET /runs/:id`가 복원된 event/output 표시
- [x] restart 후 approve endpoint 동작
- [ ] corrupted snapshot fail-closed 처리

### P12.3 Regression

- [x] run 생성 후 server restart simulation
- [x] pending approval 복원
- [x] restart 후 approve 성공
- [x] duplicate approve 실패
- [x] `npm test`에 포함

## 구현 결과 (2026-06-15)

- `RuntimeRepository` interface와 memory/jsonl 구현을 추가했다.
- `createPersistentRuntimeState()`, `rehydrateRuntimeState()`가 server startup에서 snapshot과 event log를 복원한다.
- runtime loop의 `emit()`, approve/reject, run 생성/완료 경로가 repository에 snapshot/event를 저장한다.
- `WARDEN_STORAGE=jsonl`, `WARDEN_STORAGE_DIR=<dir>` 설정으로 restart 후 pending approval을 복원하고 approve할 수 있다.
- `demo/run-warden-runtime-persistence-regression.ts`와 `demo:warden:runtime-persistence`가 restart simulation, pending approval 복원, duplicate approve 실패를 검증한다.

## 남은 후속작업

- corrupted JSONL snapshot/event를 의도적으로 주입하는 fail-closed 회귀가 아직 없다.
- `sqlite` storage kind는 config parser에는 남아 있지만 runtime repository에서는 명시적으로 unsupported로 실패한다.

## 완료 기준

- `warden server` 재시작 후에도 run 조회가 가능하다.
- pending approval은 재시작 후에도 승인/거부 가능하다.
- runtime events는 append-only로 보존된다.
- memory mode와 jsonl mode regression이 모두 통과한다.

## 위험과 판단

- 현재 `RuntimeRun` 객체가 커질 수 있어 snapshot 파일이 비대해질 수 있다.
- output에 큰 KnowledgeUnit 배열이 들어가면 artifact 분리 저장이 필요하다.
- SQLite 타입은 있지만 구현이 없으므로 P12는 JSONL-first로 닫는 것이 안전하다.
