import { spawn } from "node:child_process";

const result = await runCli(["run", "Runtime CLI regression objective.", "--iterations", "2"]);

assertIncludes(result.stdout, "WARDEN CLI", "header");
assertIncludes(result.stdout, "계획 제안을 요청하는 중", "model request progress");
assertIncludes(result.stdout, "run_warden_team를 정책/MCP로 전달하는 중", "tool routing progress");
assertIncludes(result.stdout, "run_warden_team: 성공", "team tool result");
assertIncludes(result.stdout, "소요 시간:", "elapsed summary");
assertIncludes(result.stdout, "추적 이벤트:", "trace summary");
assertIncludes(result.stdout, "상태: 승인 대기", "approval status");
assertIncludes(result.stdout, "ACH 생존 가설:", "survivor summary");

console.log("WARDEN CLI regression: passed");

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["bin/warden.mjs", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NO_COLOR: "1",
        WARDEN_MODEL_PROVIDER: "mock"
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
