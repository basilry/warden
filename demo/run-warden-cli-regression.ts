import { spawn } from "node:child_process";

const result = await runCli(["run", "Runtime CLI regression objective.", "--iterations", "2"]);

assertIncludes(result.stdout, "WARDEN CLI", "header");
assertIncludes(result.stdout, "분석계획", "investigation plan stage");
assertIncludes(result.stdout, "external_osint_fetch를 정책/MCP로 전달하는 중", "external approval preflight progress");
assertIncludes(result.stdout, "external_osint_fetch: 차단됨", "external approval blocked result");
assertIncludes(result.stdout, "상태: 승인 대기 · 소요", "elapsed summary");
assertIncludes(result.stdout, "팀 실행:", "team run summary");
assertIncludes(result.stdout, "상태: 승인 대기", "approval status");
assertIncludes(result.stdout, "ACH: 생존 가설", "survivor summary");

console.log("WARDEN CLI regression: passed");

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
