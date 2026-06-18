import { spawn } from "node:child_process";

const result = await runCliInteractive();
const oneShotResult = await runCliOneShotWithApproval();

assertIncludes(result.stdout, "WARDEN CLI Runtime", "welcome header");
assertIncludes(result.stdout, "external_osint_fetch를 승인하시겠습니까? 예(y) / 아니오(n):", "approval prompt");
assertIncludes(result.stdout, "[승인] external_osint_fetch 승인 요청이 승인됨", "approval resolved event");
assertIncludes(result.stdout, "[수집] external_osint_fetch 승인 후 SourceVet 검증과 ACH 재평가를 완료했습니다. (수집", "fetch succeeded event counts");
assertIncludes(result.stdout, "근거수집", "evidence collection heading");
assertIncludes(result.stdout, "실시간 OSINT: 3건 수집,", "OSINT evidence summary");
assertIncludes(result.stdout, "건 보류", "relevance-held evidence summary");
assertIncludes(result.stdout, "SourceVet: 통과", "sourcevet summary");
assertIncludes(result.stdout, "상태: 성공", "final status");
assertIncludes(oneShotResult.stdout, "external_osint_fetch를 승인하시겠습니까? 예(y) / 아니오(n):", "one-shot approval prompt");
assertIncludes(oneShotResult.stdout, "상태: 성공", "one-shot final status");

console.log("WARDEN CLI operator UX regression: passed");

async function runCliInteractive(): Promise<{ stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["bin/warden.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NO_COLOR: "1",
      WARDEN_MODEL_PROVIDER: "mock",
      WARDEN_OSINT_LIVE_OPT_IN: "false"
    },
    stdio: ["pipe", "pipe", "pipe"]
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

  const closed = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, 10_000);

  child.stdin.write("대한민국 공급망 리스크를 operator UX 기준으로 검증해줘\n");
  await waitForOutput(() => stdout.includes("승인하시겠습니까?"), () => stdout, "approval prompt");
  child.stdin.write("y\n");
  await waitForOutput(() => stdout.includes("상태: 성공"), () => stdout, "successful approved resume");
  child.stdin.write("/exit\n");

  const code = await closed;
  clearTimeout(timeout);
  if (code !== 0) {
    throw new Error(`warden CLI exited with code=${code}\nstdout=${stdout}\nstderr=${stderr}`);
  }
  return { stdout, stderr };
}

async function runCliOneShotWithApproval(): Promise<{ stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["bin/warden.mjs", "run", "대한민국 공급망 리스크를 one-shot approval UX 기준으로 검증해줘"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NO_COLOR: "1",
      WARDEN_MODEL_PROVIDER: "mock",
      WARDEN_OSINT_LIVE_OPT_IN: "false"
    },
    stdio: ["pipe", "pipe", "pipe"]
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

  const closed = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, 10_000);

  await waitForOutput(() => stdout.includes("승인하시겠습니까?"), () => stdout, "one-shot approval prompt");
  child.stdin.write("y\n");

  const code = await closed;
  clearTimeout(timeout);
  if (code !== 0) {
    throw new Error(`warden CLI one-shot exited with code=${code}\nstdout=${stdout}\nstderr=${stderr}`);
  }
  return { stdout, stderr };
}

async function waitForOutput(condition: () => boolean, readStdout: () => string, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}\nstdout=${readStdout()}`);
}

function assertIncludes(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} missing expected output: ${expected}\n${value}`);
  }
}
