import { spawn } from "node:child_process";

const result = await runCli(["run", "대한민국 및 동북아 공급망에 대해 알려줘", "--iterations", "2"]);

assertIncludes(result.stdout, "결론", "compact verdict heading");
assertIncludes(result.stdout, "현재 판단", "decision label");
assertIncludes(result.stdout, "판정 수준", "verdict status label");
assertIncludes(result.stdout, "분석계획", "investigation plan event");
assertIncludes(result.stdout, "근거수집", "evidence collection heading");
assertIncludes(result.stdout, "참조한 자료", "evidence citation heading");
assertIncludes(result.stdout, "분석/검증", "verification heading");
assertIncludes(result.stdout, "신뢰도 개선", "confidence improvement heading");
assertIncludes(result.stdout, "승인/다음 단계", "approval and next steps heading");
assertIncludes(result.stdout, "도메인: 공급망", "dynamic supply-chain domain");
assertIncludes(result.stdout, "ACH: 생존 가설 0개", "approval preflight before ACH");
assertIncludes(result.stdout, "external_osint_fetch", "blocked approval");
assertIncludes(result.stdout, "상태: 승인 대기", "approval status");

const assisted = await runCli([
  "run",
  "대한민국 및 동북아 공급망에 대해 알려줘",
  "--iterations",
  "2",
  "--answer-mode",
  "assisted"
]);
assertIncludes(assisted.stdout, "승인 대기", "assisted waits for approval before final answer drafting");
assertIncludes(assisted.stdout, "결론", "assisted compact verdict");

const json = await runCli(["run", "대한민국 및 동북아 공급망에 대해 알려줘", "--iterations", "2", "--json"]);
const parsed = JSON.parse(json.stdout) as {
  status?: string;
  answerMode?: string;
  outputs?: { answer?: { directAnswer?: string; blockedActions?: string[] } };
};
assertEqual(parsed.status, "waiting_approval", "json status");
assertEqual(parsed.answerMode, "deterministic", "json answer mode");
if (!parsed.outputs?.answer?.directAnswer?.includes("아직 확정 가능한 WARDEN 분석 결과가 없습니다")) {
  throw new Error(`json answer missing approval-preflight summary: ${json.stdout}`);
}
if (!parsed.outputs.answer.blockedActions?.some((item) => item.includes("external_osint_fetch"))) {
  throw new Error(`json answer missing blocked action: ${json.stdout}`);
}

console.log("WARDEN answer regression: passed");

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["bin/warden.mjs", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NO_COLOR: "1",
        WARDEN_MODEL_PROVIDER: "mock",
        WARDEN_APPROVAL_PROMPT: "0"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`warden CLI exited with code=${code}\nstdout=${stdout}\nstderr=${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} failed: expected=${String(expected)} actual=${String(actual)}`);
  }
}
