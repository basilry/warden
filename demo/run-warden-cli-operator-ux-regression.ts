import { spawn } from "node:child_process";

const result = await runCliInteractive();

assertIncludes(result.stdout, "WARDEN CLI Runtime", "welcome header");
assertIncludes(result.stdout, "[승인] external_osint_fetch 승인 요청이 승인됨", "approval resolved event");
assertIncludes(result.stdout, "[수집] external_osint_fetch 승인 후 SourceVet 검증과 ACH 재평가를 완료했습니다. (수집", "fetch succeeded event counts");
assertIncludes(result.stdout, "외부 수집:", "runtime diagnostics heading");
assertIncludes(result.stdout, "ACH 승격", "promoted evidence summary");
assertIncludes(result.stdout, "SourceVet:", "sourcevet summary");
assertIncludes(result.stdout, "상태: 성공", "final status");

console.log("WARDEN CLI operator UX regression: passed");

async function runCliInteractive(): Promise<{ stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["bin/warden.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NO_COLOR: "1",
      WARDEN_MODEL_PROVIDER: "mock"
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
  await waitForOutput(() => stdout.includes("승인 대기열:"), () => stdout, "approval queue");
  child.stdin.write("/approve external_osint_fetch\n");
  await waitForOutput(() => stdout.includes("상태: 성공"), () => stdout, "successful approved resume");
  child.stdin.write("/exit\n");

  const code = await closed;
  clearTimeout(timeout);
  if (code !== 0) {
    throw new Error(`warden CLI exited with code=${code}\nstdout=${stdout}\nstderr=${stderr}`);
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
