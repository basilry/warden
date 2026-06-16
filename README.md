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
│ Session                  │ 명령어: /runs · /approve · /server · /help · /exit │
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
- external_osint_fetch: 외부 호출은 사람의 승인이 있을 때까지 차단됩니다. (EXTERNAL)

상태: 승인 대기
```

한 번만 실행하려면:

```bash
warden run "방산 공급망 핵심 부품 수입 급감 원인을 분석해줘"
```

모델 보조 답변 초안을 추가하려면:

```bash
warden run "대한민국 및 동북아 공급망에 대해 알려줘" --answer-mode assisted
```

기계가 읽을 JSON 결과가 필요하면:

```bash
warden run "대한민국 및 동북아 공급망에 대해 알려줘" --json
```

대화형 모드에서 승인 대기 run을 재개하려면:

```text
/approve external_osint_fetch
```

`warden run` 1회 실행은 상태를 유지하지 않고 종료되므로 승인 후 재개가 필요하면 `warden` 대화형 모드나 `warden server`를 사용합니다.

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

승인 대기 중인 외부 fetch를 승인하고 run을 재개합니다.

```bash
curl -sS -X POST http://127.0.0.1:8787/runs/<runId>/approvals/<approvalId>/approve \
  -H 'content-type: application/json' \
  -d '{"actor":"operator","reason":"approved"}'
```

기본 경로는 offline-first입니다. live LLM, live MCP, 외부 네트워크 없이 mock model proposal, policy gate, WARDEN internal MCP-style tool, approval queue, 승인 후 deterministic fetch fixture까지 검증합니다. `WARDEN_OSINT_LIVE_OPT_IN=true`를 명시하면 승인 후 live OSINT 검색 provider를 사용할 수 있습니다. 정적 HTML report는 기본 실행 경로가 아니라 `npm run demo:warden:report`로 생성하는 선택 산출물입니다.

## Main Commands

| Command | Purpose |
|---|---|
| `npm run cli` | local `warden` CLI 실행 |
| `warden` | npm link/install 후 대화형 CLI 실행 |
| `warden run "<objective>"` | objective 1회 실행 |
| `warden run "<objective>" --answer-mode assisted` | 모델 보조 답변 초안 포함 |
| `warden run "<objective>" --json` | answer object 포함 JSON 출력 |
| `/approve [approvalId\|toolName]` | 대화형 CLI에서 승인 대기 action 승인 후 재개 |
| `/reject [approvalId\|toolName]` | 대화형 CLI에서 승인 대기 action 거부 |
| `warden server` | HTTP runtime server 실행 |
| `npm start` | WARDEN Agent Runtime Server 실행 |
| `npm run server` | `npm start`와 동일 |
| `npm run build` | import/build sanity check |
| `npm run demo:warden:cli` | CLI regression |
| `npm run demo:warden:answer` | CLI answer regression |
| `npm run demo:warden:runtime` | runtime server API regression |
| `npm run demo:warden:planner` | planner proposal validation regression |
| `npm run demo:warden:cli-operator-ux` | 대화형 approve/resume CLI UX regression |
| `npm run demo:warden:approval-resume` | approval approve/reject/resume regression |
| `npm run demo:warden:domain` | Korea/Northeast Asia supply-chain grounding regression |
| `npm run demo:warden` | P0 specialist team demo |
| `npm run demo:warden:p1` | job, approval, model boundary, knowledge store demo |
| `npm run demo:warden:sourcevet` | SourceVet 출처 검증 포함 demo |
| `npm run demo:warden:report` | HTML audit report 생성 |
| `npm run demo:warden:persistence` | JSONL persistence, restart load, bundle export/import demo |
| `npm run demo:warden:codex` | Codex CLI model adapter dry-run demo |
| `npm run demo:warden:regression` | WARDEN regression suite |
| `npm run demo:warden:p5-regression` | live/security/MCP/ingestion guardrail regression |
| `npm run demo:warden:ach-mcp` | ACH MCP extraction regression |
| `npm run demo:warden:runtime-persistence` | durable runtime state regression |
| `npm run demo:warden:live-osint-guard` | live OSINT approval/allowlist guard regression |
| `npm run demo:warden:sourcevet-ach-resume` | approval 후 SourceVet + ACH resume regression |
| `npm run demo:warden:live-osint-resume` | live OSINT search provider + ACH resume regression |
| `npm run demo:warden:resume-failure` | approval 후 live resume 실패 상태 처리 regression |
| `npm run demo:warden:osint-search-mcp` | natural-language OSINT search MCP regression |
| `npm run demo:warden:osint-mcp-boundary` | runtime resume의 OSINT MCP invoker 우선 경계 regression |
| `npm run demo:warden:osint-scrape-mcp` | approved URL HTML scrape MCP regression |
| `npm run demo:warden:osint-provider-quality` | OSINT provider telemetry/rate-limit/reliability regression |
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
- `/approve [approvalId|toolName]`: 승인 대기 action 승인 및 deterministic resume
- `/reject [approvalId|toolName]`: 승인 대기 action 거부 및 failed 처리
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
| `POST /runs/:id/approvals/:approvalId/approve` | 승인 대기 action 승인 후 deterministic resume |
| `POST /runs/:id/approvals/:approvalId/reject` | 승인 대기 action 거부 |

현재 loop 동작:

- Supervisor runtime loop가 model adapter에 planner proposal을 요청하고 allowlist/schema 검증을 통과한 proposal만 tool plan으로 승격합니다.
- 1회차에는 승인된 proposal 또는 deterministic fallback으로 `run_warden_team` capability를 MCP router/policy gate를 통해 실행합니다.
- 내부 WARDEN specialist team이 ACH, SourceVet, verifier trace를 생성합니다.
- 2회차 이후 외부 OSINT 성격의 `external_osint_fetch`는 자동 실행하지 않고 approval pending으로 남깁니다.
- 승인 후 재개는 기본적으로 deterministic local fetch fixture를 반영합니다.
- `WARDEN_OSINT_LIVE_OPT_IN=true`이면 승인 후 자연어 objective를 OSINT 검색 provider로 전달하고, 결과를 SourceVet 검토 후 ACH 재평가에 투입합니다.
- 모델 출력은 실행 권한이 아니라 proposal로만 저장됩니다.

런타임 smoke test:

```bash
npm run demo:warden:cli
npm run demo:warden:runtime
```

자세한 사용 방식은 `docs/runtime.md`를 참고하세요.

## Live OSINT Search

외부 검색은 기본 비활성입니다. 실제 인터넷 검색을 쓰려면 operator가 명시적으로 opt-in해야 하고, run 안에서 `external_osint_fetch` approval도 승인해야 합니다.

```bash
WARDEN_OSINT_LIVE_OPT_IN=true warden
```

기본 검색 소스 파일:

```text
fixtures/osint/search-sources.json
```

포함된 provider:

- GDELT DOC article search: 공개 뉴스 검색, API key 불필요
- Brave Web Search: `BRAVE_SEARCH_API_KEY`가 있을 때 사용
- Brave Investing.com scoped search: `site:investing.com` 기반 시장/공급망 뉴스 검색
- Yonhap RSS: 한국어 국제 뉴스 보강

검색 provider에는 reliability profile, cooldown, backoff 설정을 둘 수 있습니다. 429, timeout, HTTP error는 provider telemetry와 warning으로 남습니다.

주요 환경 변수:

```bash
WARDEN_OSINT_LIVE_OPT_IN=true
WARDEN_OSINT_SEARCH_ENABLED=true
WARDEN_OSINT_SEARCH_SOURCES=fixtures/osint/search-sources.json
WARDEN_OSINT_MAX_RESULTS=5
WARDEN_OSINT_TIMEOUT_MS=8000
BRAVE_SEARCH_API_KEY=...
```

검색 결과는 바로 ACH에 들어가지 않습니다.

```text
사용자 자연어 objective
-> external_osint_fetch approval
-> OSINT search MCP/connector
-> KnowledgeUnit normalization
-> SourceVet 검토
-> 통과 evidence만 ACH 재평가
-> 답변에 survivor delta와 source 한계 표시
```

기존 allowlist JSON endpoint 방식만 검증하려면 search를 끕니다.

```bash
WARDEN_OSINT_LIVE_OPT_IN=true WARDEN_OSINT_SEARCH_ENABLED=false npm run demo:warden:live-osint-guard
```

OSINT MCP에는 자연어 검색과 HTML scrape 도구가 있습니다.

| MCP tool | Purpose | Guard |
|---|---|---|
| `search_news` | 자연어 query를 allowlisted search/RSS provider로 검색 | `WARDEN_OSINT_LIVE_OPT_IN=true` |
| `scrape_news` | 승인된 http/https URL의 HTML title/text/link를 추출 | `WARDEN_OSINT_LIVE_OPT_IN=true`, localhost/private IP 차단 |

HTML scrape는 현재 HTTP fetch 기반 1차 구현입니다. JS 렌더링, 로그인, 강한 bot 방어가 필요한 페이지는 후속 Web Scraper MCP 단계에서 보강합니다.

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
- ACH MCP, OSINT search MCP, OSINT scrape MCP regression
- approval resume failure, OSINT MCP boundary, provider quality regression
- interactive CLI operator approval/resume UX regression

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
- ACH MCP extraction
- natural-language OSINT search MCP
- approved HTML scrape MCP
- SourceVet + ACH resume after external approval
- runtime resume failure hardening
- OSINT provider telemetry/reliability/cooldown

명시적 non-goals:

- production deployment
- 군 내부망 적용 완료 주장
- 보안 인증 보유 주장
- 무승인 autonomous external collection
- customer operational reference claim
