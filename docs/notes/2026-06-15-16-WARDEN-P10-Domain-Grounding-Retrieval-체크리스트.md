---
type: phase-checklist
date: 2026-06-15
project: 02021-warden-agents
phase: P10
subject: WARDEN P10 Domain Grounding and Retrieval 체크리스트
tags:
  - project
  - WARDEN
  - phase
  - checklist
  - domain-grounding
  - retrieval
  - supply-chain
  - 동북아
  - 방산
status: implemented-partial
related:
  - "[[2026-06-15-13-WARDEN-P7-실사용-답변엔진-체크리스트]]"
  - "[[2026-06-15-15-WARDEN-P9-Approval-Resume-Evidence-Fetch-체크리스트]]"
---

# WARDEN P10 Domain Grounding and Retrieval 체크리스트

## 목표

P10의 목표는 넓은 질문이 고정 fixture 답변으로만 귀결되지 않게 하고, 한국/동북아 공급망 질문에 로컬 domain grounding을 붙이는 것이다.

## 현재 구현 상태

- `src/agent/domain/question-classifier.ts`에 공급망 질문 분류기를 추가했다.
- `fixtures/domain/korea-northeast-asia-supply-chain.json`에 한국/동북아 공급망 domain profile을 추가했다.
- `src/agent/knowledge/retrieval.ts`에 tag/lexical retrieval을 추가했다.
- `src/runtime/loop.ts`가 objective를 보고 domain grounding을 run outputs에 저장한다.
- `src/runtime/answer.ts`가 domain evidence, profile limit, authority refs를 답변에 반영한다.
- ACH case 자체의 evidence matrix에는 아직 domain retrieved evidence가 직접 들어가지 않는다.

## 생성 파일

| 파일 | 상태 | 목적 |
|---|---:|---|
| `src/agent/domain/question-classifier.ts` | 완료 | 질문 유형/지역/산업/리스크 분류 |
| `src/agent/domain/supply-chain-profile.ts` | 완료 | domain profile loader/validator |
| `src/agent/knowledge/retrieval.ts` | 완료 | keyword/tag 기반 retrieval |
| `fixtures/domain/korea-northeast-asia-supply-chain.json` | 완료 | 초기 domain fixture |
| `docs/domain/supply-chain-question-patterns.md` | 완료 | 질문 패턴과 grounding 정책 |
| `demo/run-warden-domain-regression.ts` | 완료 | domain grounding regression |

## 수정 파일

| 파일 | 상태 | 수정 내용 |
|---|---:|---|
| `src/runtime/loop.ts` | 완료 | objective context retrieval 연결 |
| `src/runtime/answer.ts` | 완료 | domain grounding status/evidence/limits 반영 |
| `src/runtime/types.ts` | 완료 | `RuntimeDomainGrounding` 추가 |
| `package.json` | 완료 | `demo:warden:domain` 및 `npm test` 연결 |
| `src/agent/team-runner.ts` | 미완료 | retrieved evidence를 Evidence Curator 입력으로 전달 필요 |
| `src/agent/agents/case-framer.ts` | 미완료 | question type 기반 hypothesis 조정 필요 |
| `src/agent/agents/evidence-curator.ts` | 미완료 | fixture + retrieved evidence 병합 필요 |

## 체크리스트

### P10.0 Domain Profile

- [x] 한국/동북아 region profile fixture 작성
- [x] sector keyword 정의
- [x] commodity/critical material keyword 정의
- [x] risk type keyword 정의
- [x] profile source/provenance 표시

### P10.1 Question Classifier

- [x] regional overview 분류
- [x] component disruption 계열 키워드 분류
- [x] supplier/dependency risk 분류
- [x] export control 분류
- [x] logistics route risk 분류
- [x] unknown fallback

### P10.2 Retrieval

- [x] objective keyword extraction
- [x] knowledge unit scoring
- [x] top-k retrieval
- [ ] duplicate source collapse
- [x] reliability score 반영
- [x] insufficient evidence warning

### P10.3 Team Integration

- [x] runtime answer context에 domain context 전달
- [x] answer에 retrieved domain evidence 표시
- [x] answer에 profile 한계 표시
- [ ] domain context를 Case Framer에 전달
- [ ] retrieved units를 Evidence Curator에 전달
- [ ] retrieved evidence가 ACH case에 반영
- [ ] SourceVet 대상에 retrieved source 포함

### P10.4 Regression

- [x] “대한민국 및 동북아 공급망” 질문이 regional overview로 분류됨
- [x] non-domain 질문 fallback
- [x] domain fixture가 있으면 answer evidence에 표시
- [x] insufficient/profile limit warning 표시
- [x] `npm test`에 포함

## 검증

- [x] `npm run demo:warden:domain`
- [x] `warden run "대한민국 및 동북아 공급망에 대해 알려줘" --json` with mock provider
- [x] `npm test`

## 완료 기준 판정

- 일반 공급망 질문이 고정 방산 부품 fixture 답변으로만 끝나지 않음: 완료
- 답변에 domain context와 근거 한계 표시: 완료
- retrieved evidence가 ACH와 answer에 연결: answer 완료, ACH 미완료
- 근거 부족/fixture 한계 표시: 완료

## 다음 작업

- `RunOptions` 또는 team input에 `domainGrounding`을 추가해 Case Framer와 Evidence Curator가 사용하도록 만든다.
- domain retrieved evidence가 ACH matrix에 들어가면 기존 fixture 가설과 domain 가설의 충돌/중복을 검증해야 한다.
