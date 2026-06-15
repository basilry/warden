# WARDEN 3-Minute Demo Script

## 0:00-0:20 Problem

"방산 분석에서 AI 답변보다 중요한 것은 통제와 감사입니다. 누가 어떤 근거로 판단했는지, 외부 호출이 승인됐는지, 같은 입력을 다시 재현할 수 있는지가 핵심입니다."

## 0:20-0:50 Team Run

Screen:

```bash
npm run demo:warden
```

Message:

"WARDEN은 Supervisor가 Case Framer, Evidence Curator, ACH Analyst, Verifier, Briefing Agent를 지휘하는 구조입니다. 모든 handoff는 trace에 남습니다."

## 0:50-1:20 ACH Result

Screen:

```bash
npm run demo:warden:sourcevet
```

Message:

"최종 판단은 LLM이 직접 내리지 않습니다. ACH matrix가 경쟁 가설을 결정적으로 비교하고, Verifier가 evidence reliability와 matrix completeness를 검증합니다."

## 1:20-1:45 SourceVet And Policy

Message:

"SourceVet은 출처 신뢰도, 독립 검증, 순환 인용을 확인합니다. Policy Reviewer는 planned tool call을 실행 전에 검토합니다."

## 1:45-2:15 Approval And Trace

Screen:

```bash
npm run demo:warden:p1
```

Message:

"외부 OSINT fetch는 실행되지 않고 approval pending으로 남습니다. WARDEN은 silent external call을 허용하지 않습니다."

## 2:15-2:45 HTML Report

Screen:

```bash
npm run demo:warden:report
```

Open:

```text
reports/<runId>/index.html
```

Message:

"비개발 검토자는 HTML audit report에서 job history, approval queue, policy decision, SourceVet flags, ACH output, trace timeline을 확인할 수 있습니다."

## 2:45-3:00 PoC Ask

"초기 PoC는 수요기업의 문서 샘플과 승인 정책을 받아 offline-first workflow로 재현 가능한 분석 패키지를 만드는 것입니다. Live model과 외부 MCP는 명시적 opt-in으로만 연결됩니다."
