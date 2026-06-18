---
type: development-plan
date: 2026-06-15
project: 02021-warden-agents
phase: P13
subject: WARDEN P13 Live OSINT Connector 개발계획
tags:
  - project
  - WARDEN
  - phase
  - OSINT
  - connector
  - sourcevet
  - live
  - 방산
status: implemented-with-followups
related:
  - "[[2026-06-15-17-WARDEN-P8-P10-구현-리뷰-및-전체평가]]"
  - "[[2026-06-15-19-WARDEN-P11-SourceVet-ACH-Resume-Integration-개발계획]]"
  - "[[2026-06-15-20-WARDEN-P12-Durable-Runtime-State-개발계획]]"
---

# WARDEN P13 Live OSINT Connector 개발계획

## 목표

P13의 목표는 `external_osint_fetch`를 deterministic local fixture에서 실제 allowlisted live OSINT connector로 확장하는 것이다.

현재 상태:

- approval 후에도 `src/runtime/external-fetch.ts`는 local fixture `KnowledgeUnit[]`만 반환한다.
- 네트워크 egress는 기본적으로 없다.
- SourceVet/ACH 재평가 루프가 아직 완전하지 않다.

P13 완료 후:

- explicit opt-in과 human approval이 있어야 live OSINT fetch가 실행된다.
- fetch 대상은 allowlist된 source 또는 connector로 제한된다.
- 결과는 schema validation, redaction, SourceVet gate를 거친다.
- live evidence는 audit bundle에 provenance와 함께 저장된다.

## 선행 조건

- P11 SourceVet/ACH resume integration
- P12 durable runtime state
- allowlist policy 합의
- rate limit, timeout, redaction 기준 합의

## 범위

포함:

- allowlisted HTTP/source connector
- live opt-in env guard
- timeout/retry/rate limit
- result normalization to `KnowledgeUnit[]`
- SourceVet required gate
- redaction
- audit artifact 저장
- regression

제외:

- 무제한 web crawling
- browser automation crawling
- 유료 API 통합
- classified/sensitive source ingestion
- autonomous external collection

## 생성 파일

| 파일 | 목적 |
|---|---|
| `src/connectors/osint/types.ts` | live OSINT connector type |
| `src/connectors/osint/allowlist.ts` | source allowlist validation |
| `src/connectors/osint/http-client.ts` | timeout/rate-limit HTTP client |
| `src/connectors/osint/normalizer.ts` | HTTP/API result -> KnowledgeUnit |
| `src/runtime/live-osint-fetch.ts` | approved live fetch orchestration |
| `fixtures/osint/allowlist.json` | local development allowlist |
| `demo/run-warden-live-osint-guard-regression.ts` | no opt-in/no approval/allowlist regression |

## 수정 파일

| 파일 | 수정 내용 |
|---|---|
| `src/runtime/external-fetch.ts` | fixture provider와 live provider interface 분리 |
| `src/runtime/loop.ts` 또는 `src/runtime/resume.ts` | approval 후 live/fixture provider 선택 |
| `src/agent/config.ts` | `WARDEN_OSINT_LIVE_OPT_IN`, `WARDEN_OSINT_ALLOWLIST` 추가 |
| `src/agent/security/redaction.ts` | live source payload redaction 강화 |
| `src/agent/sourcevet-scenarios.ts` 또는 SourceVet tools | live source profile 처리 |
| `docs/security.md` | live egress policy 업데이트 |
| `README.md` | live OSINT 사용 경고 및 명령 추가 |
| `package.json` | guard regression 추가 |

## 핵심 타입

```ts
type OsintConnectorConfig = {
  liveOptIn: boolean;
  allowlistPath: string;
  timeoutMs: number;
  maxResults: number;
  userAgent: string;
};

type OsintFetchRequest = {
  query: string;
  approvalId: string;
  runId: string;
  allowedSources?: string[];
};

type OsintFetchResult = {
  units: KnowledgeUnit[];
  artifacts: StoredArtifact[];
  sourceVetRequired: true;
  warnings: string[];
};
```

## 핵심 함수

- `loadOsintAllowlist(path)`
- `assertOsintLiveOptIn(config)`
- `assertSourceAllowed(url, allowlist)`
- `fetchAllowedOsintSources(request, config)`
- `normalizeOsintResponseToKnowledgeUnits(response, provenance)`
- `redactOsintPayload(payload)`
- `runApprovedLiveOsintFetch(run, approval, config)`
- `persistOsintArtifacts(runId, result)`

## 정책 로직

1. `approval.status === "approved"`가 아니면 live fetch 금지
2. `WARDEN_OSINT_LIVE_OPT_IN=true`가 아니면 live fetch 금지
3. source가 allowlist에 없으면 fetch 금지
4. direct URL fetch는 allowlist된 domain/path만 허용
5. timeout 초과는 fail-closed
6. response schema validation 실패 시 evidence promotion 금지
7. redaction 후 artifact 저장
8. SourceVet 통과 전에는 ACH 반영 금지

## 구현 로직

1. 승인된 `external_osint_fetch` action을 받는다.
2. provider mode를 결정한다.
   - 기본: deterministic fixture
   - opt-in: live OSINT connector
3. allowlist를 로드한다.
4. query 또는 URL을 allowlist policy에 매핑한다.
5. HTTP/API request를 timeout과 rate limit 안에서 실행한다.
6. response를 `KnowledgeUnit[]`으로 정규화한다.
7. raw/redacted artifact를 durable storage에 저장한다.
8. SourceVet을 강제로 실행한다.
9. SourceVet 통과 evidence만 P11 ACH resume path로 전달한다.

## 체크리스트

### P13.0 Guardrails

- [x] live opt-in env guard
- [x] human approval required guard
- [x] allowlist domain/path guard
- [x] timeout fail-closed
- [x] max result limit
- [x] no broad crawling policy

### P13.1 Connector

- [x] connector config type
- [x] HTTP client wrapper
- [x] source allowlist loader
- [x] response normalizer
- [x] provenance builder
- [x] redaction hook

### P13.2 SourceVet/Audit

- [x] live fetched units SourceVet required
- [x] raw/redacted artifact 저장
- [x] source lineage metadata 저장
- [x] SourceVet fail 시 ACH 미반영
- [x] answer에 live source 한계 표시

### P13.3 Regression

- [x] no approval -> no egress
- [x] no live opt-in -> fixture fallback 또는 fail
- [x] non-allowlisted source -> blocked
- [x] timeout -> fail-closed
- [x] malformed response -> fail-closed
- [ ] SourceVet failure -> ACH 미반영
- [x] `npm test` 기본 경로는 offline 유지

## 구현 결과 (2026-06-15)

- `src/connectors/osint/*`에 allowlist, HTTP timeout client, normalizer, type을 추가했다.
- `src/runtime/live-osint-fetch.ts`가 approval, live opt-in, allowlist, timeout, malformed response를 fail-closed로 처리한다.
- live fetch 성공 결과는 `sourceVetRequired: true`, `promoteToAch: false`로 반환되어 SourceVet 전 ACH 반영이 차단된다.
- raw/redacted artifact 객체를 생성하고, redaction hook을 거친 payload를 runtime resume output에 보존한다.
- `WARDEN_OSINT_LIVE_OPT_IN=true`이면 approval resume path가 fixture provider 대신 live OSINT provider를 선택할 수 있다.
- `demo/run-warden-live-osint-guard-regression.ts`와 `demo:warden:live-osint-guard`가 no approval, no opt-in, non-allowlist, timeout, malformed response, 성공 guard를 검증한다.
- `demo/run-warden-live-osint-resume-regression.ts`와 `demo:warden:live-osint-resume`가 live provider 결과가 SourceVet 이후 ACH resume에 들어가는 경로를 네트워크 없이 검증한다.
- 02010_desk_defense의 Brave/GDELT/RSS OSINT 패턴을 참고해 자연어 OSINT 검색 provider registry를 추가했다.
- `fixtures/osint/search-sources.json`에 GDELT DOC, Brave Web Search, Brave Investing.com scoped search, Yonhap RSS를 설정했다. 현재 NHK RSS URL은 live smoke에서 404라 disabled 처리했다.
- `src/mcp/osint/*`와 `src/agent/mcp/osint-client.ts`를 추가해 `search_news` OSINT MCP tool을 제공한다. 이 tool은 `approvalId`와 `WARDEN_OSINT_LIVE_OPT_IN=true` 없이는 실행되지 않는다.
- `demo/run-warden-osint-search-mcp-regression.ts`와 `demo:warden:osint-search-mcp`가 자연어 query, preferred domain(`investing.com`), SourceVet-required KnowledgeUnit 변환을 검증한다.
- live smoke 결과: GDELT는 공개 endpoint가 429 또는 timeout을 반환해 fail-closed 동작을 확인했고, Yonhap RSS는 한국어 query(`한국`)로 실제 기사 1건을 수집했다.

## 남은 후속작업

- live SourceVet failure가 ACH 미반영으로 이어지는 negative regression은 아직 없다.
- 최종 사용자 answer에 redacted artifact ref를 더 명시적으로 표시하는 작업이 남아 있다.
- Brave/Investing.com scoped search는 `BRAVE_SEARCH_API_KEY`가 있을 때만 동작한다.
- GDELT rate limit에 대비해 provider별 retry/backoff 또는 source priority 조정이 필요하다.

## 완료 기준

- 기본 `npm test`는 네트워크 없이 통과한다.
- live OSINT는 explicit opt-in + approval + allowlist 없이는 실행되지 않는다.
- live result는 SourceVet 전에는 ACH에 들어가지 않는다.
- 모든 live fetch는 provenance, redaction, audit artifact를 남긴다.

## 위험과 판단

- live OSINT는 latency와 flaky failure가 생기므로 기본 회귀에 넣지 않는다.
- source allowlist가 너무 넓으면 보안 경계가 무너진다.
- 최초 구현은 1~2개 source connector만 허용하고, broad search/crawl은 금지한다.
