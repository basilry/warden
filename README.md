# WARDEN Agents

WARDEN은 방산 분석 workflow에서 LLM을 직접 신뢰하지 않고도 활용할 수 있게 만드는 controlled multi-agent harness입니다. 모델 출력은 proposal로만 취급하고, 실제 판단값은 policy review, approval queue, deterministic ACH, SourceVet, verifier, audit trace를 통해 통제합니다.

기본 실행 경로는 offline-first입니다. 기본 demo와 `npm test`는 live LLM, live MCP, 외부 네트워크 호출을 요구하지 않습니다.

## Requirements

- Node.js `>=22.14.0`
- npm

## Quick Start

```bash
npm install
npm run build
npm run cli
```

`npm run cli`는 로컬 개발용으로 `warden` CLI를 실행합니다. 패키지를 링크하면 터미널에서 바로 `warden` 명령을 쓸 수 있습니다.

```bash
npm link
warden
```

대화형 모드에서는 objective를 입력하고 enter를 누르면 바로 runtime loop가 실행됩니다.

```text
╭─ WARDEN CLI Runtime v0.1.0 ───────────────────────────────────────╮
│ ▼ WARDEN                 │ Agent runtime console                  │
│                          │ 경로: ~/Projects/02021_warden_agents   │
│ Session                  │ 명령어: /runs · /server · /help · /exit │
│ Model     mock           │ 최근 활동: 최근 실행 없음              │
│ Server    ready          │ .env: 사용 중                          │
│ Policy    guarded        │ 권한 경계: 오프라인/로컬               │
│ Loop      2x             │ 목표: 분석할 objective를 입력하세요.   │
│ Queue                    │ 외부 호출: 사람 승인 전까지 차단됩니다.│
│ Runs      0              │                                        │
│ Approval  0              │                                        │
│ Failures  0              │                                        │
╰───────────────────────────────────────────────────────────────────╯

▼ ❯ 방산 공급망 핵심 부품 수입 급감 원인을 분석해줘
[루프] 반복 1/2.
[모델] mock-model에 계획 제안을 요청하는 중...
[모델] 모델 제안 수신 (mock-deterministic-v1) (0ms)
[도구] run_warden_team를 정책/MCP로 전달하는 중 (WRITE)...
[도구] run_warden_team: 성공. (12ms)
[루프] 반복 2/2.
[도구] external_osint_fetch: 차단됨. (0ms)
[승인] external_osint_fetch 승인 대기 중입니다.

답변
질문 "방산 공급망 핵심 부품 수입 급감 원인을 분석해줘"에 대해 WARDEN의 현재 통제 분석에서는 제재 우회 비축,
공급망 교란 가설이 생존했습니다. 이는 확정 결론이 아니라 ACH, 정책 게이트, 검증자가 허용한 범위의 중간 분석입니다.
다만 외부 정보 수집은 승인 대기 상태라, 현재 답변은 로컬/fixture 기반 근거에 한정됩니다.

핵심 판단
- 제재 우회 비축: 현재 ACH 생존 가설입니다.
- 공급망 교란: 현재 ACH 생존 가설입니다.

승인 필요
- external_osint_fetch: External calls are blocked until human approval. (EXTERNAL)

상태: 승인 대기
```

한 번만 실행하려면:

```bash
warden run "방산 공급망 핵심 부품 수입 급감 원인을 분석해줘"
```

HTTP runtime server를 직접 띄우려면:

```bash
warden server
```

또는 npm script를 사용할 수 있습니다.

```bash
npm start
```

서버가 실행되면 다른 터미널에서 run을 생성합니다.

```bash
curl -sS -X POST http://127.0.0.1:8787/runs \
  -H 'content-type: application/json' \
  -d '{"objective":"방산 공급망 핵심 부품 수입 급감 원인을 분석해줘","maxIterations":2}'
```

run 목록과 세부 상태를 확인합니다.

```bash
curl -sS http://127.0.0.1:8787/runs
curl -sS http://127.0.0.1:8787/runs/<runId>
```

기본 경로는 offline-first입니다. live LLM, live MCP, 외부 네트워크 없이 mock model proposal, policy gate, WARDEN internal MCP-style tool, approval queue까지 검증합니다. 정적 HTML report는 기본 실행 경로가 아니라 `npm run demo:warden:report`로 생성하는 선택 산출물입니다.

## Main Commands

| Command | Purpose |
|---|---|
| `npm run cli` | local `warden` CLI 실행 |
| `warden` | npm link/install 후 대화형 CLI 실행 |
| `warden run "<objective>"` | objective 1회 실행 |
| `warden server` | HTTP runtime server 실행 |
| `npm start` | WARDEN Agent Runtime Server 실행 |
| `npm run server` | `npm start`와 동일 |
| `npm run build` | import/build sanity check |
| `npm run demo:warden:cli` | CLI regression |
| `npm run demo:warden:answer` | CLI answer regression |
| `npm run demo:warden:runtime` | runtime server API regression |
| `npm run demo:warden` | P0 specialist team demo |
| `npm run demo:warden:p1` | job, approval, model boundary, knowledge store demo |
| `npm run demo:warden:sourcevet` | SourceVet 출처 검증 포함 demo |
| `npm run demo:warden:report` | HTML audit report 생성 |
| `npm run demo:warden:persistence` | JSONL persistence, restart load, bundle export/import demo |
| `npm run demo:warden:codex` | Codex CLI model adapter dry-run demo |
| `npm run demo:warden:regression` | WARDEN regression suite |
| `npm run demo:warden:p5-regression` | live/security/MCP/ingestion guardrail regression |
| `npm test` | build + regression 전체 검증 |

## CLI

`warden`은 Codex/Claude CLI처럼 터미널에서 바로 쓰는 entrypoint입니다.

```bash
warden
warden run "Analyze defense supply-chain disruption"
warden server
```

채팅 모드 명령:

- `/runs`: 현재 CLI 세션의 run 목록
- `/server`: HTTP server 실행 명령 안내
- `/help`: 도움말
- `/exit`: 종료

기본 `warden` chat mode는 서버에 붙는 client가 아니라, 같은 프로세스 안에서 WARDEN runtime loop를 직접 실행합니다. HTTP API가 필요하면 `warden server` 또는 `npm start`를 사용합니다.

## Runtime Server

서버는 에이전트 루프를 HTTP로 실행하는 entrypoint입니다.

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | health check |
| `GET /` | server metadata and available endpoints |
| `POST /runs` | objective 기반 agent loop 생성 |
| `GET /runs` | run summary 목록 |
| `GET /runs/:id` | run event, model proposal, tool result, approval 상태 |

현재 loop 동작:

- Supervisor runtime loop가 model adapter에 planner proposal을 요청합니다.
- 1회차에는 `run_warden_team` capability를 MCP router/policy gate를 통해 실행합니다.
- 내부 WARDEN specialist team이 ACH, SourceVet, verifier trace를 생성합니다.
- 2회차 이후 외부 OSINT 성격의 `external_osint_fetch`는 자동 실행하지 않고 approval pending으로 남깁니다.
- 모델 출력은 실행 권한이 아니라 proposal로만 저장됩니다.

런타임 smoke test:

```bash
npm run demo:warden:cli
npm run demo:warden:runtime
```

자세한 사용 방식은 `docs/runtime.md`를 참고하세요.

## Recommended Demo Flow

심사나 설명용으로는 아래 순서를 권장합니다.

```bash
npm run cli
npm start
npm run demo:warden:cli
npm run demo:warden:runtime
npm run demo:warden
npm run demo:warden:p1
npm run demo:warden:sourcevet
npm run demo:warden:report
npm test
```

핵심 메시지:

- Supervisor가 specialist agent team을 지휘합니다.
- ACH가 경쟁 가설을 deterministic하게 계산합니다.
- SourceVet이 출처 신뢰도와 lineage를 검토합니다.
- EXTERNAL action은 바로 실행되지 않고 approval pending으로 남습니다.
- 모든 handoff, policy decision, tool call, verification은 trace와 report에 남습니다.

## Report Usage

리포트 생성:

```bash
npm run demo:warden:report
```

출력 예시:

```text
Report written: /Users/.../reports/run_xxx/index.html
```

리포트에는 다음이 포함됩니다.

- case summary
- job history
- approval queue
- policy decisions
- SourceVet flags
- ACH ranking and matrix
- trace timeline
- residual risks
- regression results

## Persistence And Bundle

로컬 durable state와 run bundle을 확인하려면:

```bash
npm run demo:warden:persistence
```

이 명령은 다음을 수행합니다.

- jobs, approvals, knowledge units, trace events 저장
- JSONL provider 재생성 후 restart-style load 검증
- report artifact 저장
- hashed run bundle export
- bundle import 검증

기본 출력 위치:

```text
data/p4-demo/
data/p4-demo/bundles/<runId>/
```

`data/*`는 git ignore 대상입니다.

## Codex Auth Path

Codex CLI/OAuth 경로는 dry-run이 기본입니다. WARDEN CLI/server는 프로젝트 루트의 `.env`를 자동 로드합니다.

```bash
cp .env.example .env
```

일반 로컬 사용에서는 API key를 WARDEN에 붙이지 말고 Codex CLI에 로그인합니다.

```bash
codex login
WARDEN_MODEL_PROVIDER=codex WARDEN_CODEX_DRY_RUN=0 warden run "방산 공급망 리스크를 분석해줘"
```

API key 방식으로 Codex CLI에 로그인하려면 `.env`의 `OPENAI_API_KEY`를 채운 뒤:

```bash
set -a
source .env
set +a
printenv OPENAI_API_KEY | codex login --with-api-key
```

WARDEN은 `~/.codex/auth.json`을 읽지 않습니다. Codex OAuth/API-key 인증은 Codex CLI가 담당합니다. WARDEN은 Codex output도 proposal로만 취급합니다.

WARDEN이 직접 `OPENAI_API_KEY`를 읽는 경우는 `WARDEN_MODEL_PROVIDER=openai-compatible`, `WARDEN_OPENAI_DRY_RUN=0`, `WARDEN_OPENAI_LIVE_OPT_IN=true`를 모두 켠 live OpenAI-compatible 경로뿐입니다.

자세한 내용:

- `docs/auth.md`
- `docs/security.md`

## Security Guardrails

P5 guardrail은 다음을 검증합니다.

- live model opt-in guard
- API key presence validation
- secret/bearer token redaction
- raw model tool call denial
- ACH survivor/ranking authority override detection
- egress approval-required policy
- stdio MCP command/tool allowlist
- MCP timeout and malformed response fail-closed
- text/HTML/PDF-lite ingestion provenance
- audit hash-chain candidate

실행:

```bash
npm run demo:warden:p5-regression
```

## Regression

전체 검증:

```bash
npm test
```

현재 regression 구성:

- runtime server API regression
- CLI regression
- WARDEN workflow regression
- ACH reliability failure
- Policy review failures
- SourceVet failures
- SEC no-egress/no-secret/authority regression
- JSONL storage and bundle regression
- Codex dry-run regression
- P5 live/security/MCP/ingestion regression

## Submission Package

제출용 문서 패키지 검증:

```bash
npm run submission:verify
```

제출 패키지 생성:

```bash
npm run submission:package
```

출력:

```text
submission/warden-p6-package
```

패키지에는 one-pager, 3분 demo script, architecture/security 문서, install/evaluation guide, FAQ, 최신 HTML report가 포함됩니다.

## Key Docs

| Path | Content |
|---|---|
| `docs/submission/one-pager-ko.md` | 한글 one-pager |
| `docs/submission/demo-script-3min.md` | 3분 demo 대본 |
| `docs/submission/architecture.md` | architecture diagram |
| `docs/submission/security-opsec.md` | 보안/OPSEC 설명 |
| `docs/submission/evaluation-guide.md` | 평가자 guide |
| `docs/storage.md` | storage 구조 |
| `docs/runtime.md` | runtime server 사용법 |
| `docs/mcp.md` | MCP 경계 |
| `docs/ingestion.md` | document ingestion |
| `docs/auth.md` | Codex/OpenAI auth 경계 |

## Current Scope

현재 구현 수준은 local MVP / runnable agent runtime입니다.

포함:

- HTTP runtime server
- model adapter 기반 planner proposal loop
- MCP router/policy gate 기반 tool execution
- approval pending 상태 처리
- offline deterministic multi-agent demo
- SourceVet and Policy Reviewer
- optional static HTML audit report
- JSONL persistence and bundle export/import
- Codex CLI adapter dry-run path
- security regression pack
- submission package

명시적 non-goals:

- production deployment
- 군 내부망 적용 완료 주장
- 보안 인증 보유 주장
- 무승인 autonomous external collection
- customer operational reference claim
