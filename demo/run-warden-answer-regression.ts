import { spawn } from "node:child_process";

const result = await runCli(["run", "대한민국 및 동북아 공급망에 대해 알려줘", "--iterations", "2"]);

assertIncludes(result.stdout, "답변", "answer heading");
assertIncludes(result.stdout, "핵심 판단", "findings heading");
assertIncludes(result.stdout, "근거", "evidence heading");
assertIncludes(result.stdout, "한계", "uncertainty heading");
assertIncludes(result.stdout, "승인 필요", "approval heading");
assertIncludes(result.stdout, "제재 우회 비축", "ACH survivor");
assertIncludes(result.stdout, "external_osint_fetch", "blocked approval");
assertIncludes(result.stdout, "상태: 승인 대기", "approval status");

console.log("WARDEN answer regression: passed");

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
