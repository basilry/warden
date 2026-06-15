import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const requiredDocs = [
  "docs/submission/positioning.md",
  "docs/submission/problem-definition.md",
  "docs/submission/use-cases.md",
  "docs/submission/one-pager-ko.md",
  "docs/submission/one-pager-en.md",
  "docs/submission/demo-script-3min.md",
  "docs/submission/demo-shot-list.md",
  "docs/submission/demo-checklist.md",
  "docs/submission/architecture.md",
  "docs/submission/security-opsec.md",
  "docs/submission/control-boundaries.md",
  "docs/submission/regression-summary.md",
  "docs/submission/install-guide.md",
  "docs/submission/evaluation-guide.md",
  "docs/submission/faq.md",
  "docs/submission/final-submission-list.md"
];

const supportDocs = [
  "README.md",
  "docs/auth.md",
  "docs/security.md",
  "docs/mcp.md",
  "docs/ingestion.md",
  "docs/storage.md",
  "docs/offline-runbook.md",
  "docs/troubleshooting.md"
];

const bannedClaims = [
  "군 내부망 적용 완료",
  "보안 인증 보유",
  "운영 고객 레퍼런스 확보",
  "완전 자율 방산 에이전트"
];

const verifyOnly = process.argv.includes("--verify-only");
const outputDir = resolve(process.cwd(), "submission/warden-p6-package");

verifyDocuments();
const latestReport = findLatestReport();

if (!verifyOnly) {
  mkdirSync(outputDir, { recursive: true });
  for (const doc of [...requiredDocs, ...supportDocs]) {
    copyIntoPackage(doc, join(outputDir, doc));
  }
  if (latestReport) {
    copyIntoPackage(latestReport.htmlPath, join(outputDir, "reports", basename(latestReport.dir), "index.html"));
    if (existsSync(latestReport.jsonPath)) {
      copyIntoPackage(latestReport.jsonPath, join(outputDir, "reports", basename(latestReport.dir), "report.json"));
    }
  }
  writeFileSync(
    join(outputDir, "manifest.json"),
    `${JSON.stringify(
      {
        packageName: "warden-p6-submission",
        generatedAt: new Date().toISOString(),
        requiredDocs,
        supportDocs,
        latestReport,
        verificationCommands: [
          "npm run build",
          "npm run demo:warden:report",
          "npm run demo:warden:regression",
          "npm run demo:warden:p5-regression",
          "npm test"
        ],
        scope: "local MVP submission package; not production deployment"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

console.log("WARDEN P6 submission package check");
console.log("==================================");
console.log(`Docs: ${requiredDocs.length}/${requiredDocs.length} required present`);
console.log(`Latest report: ${latestReport ? latestReport.htmlPath : "not found"}`);
console.log(verifyOnly ? "Verify only: passed" : `Package written: ${outputDir}`);

function verifyDocuments(): void {
  for (const doc of requiredDocs) {
    if (!existsSync(doc)) {
      throw new Error(`Missing submission document: ${doc}`);
    }
    const text = readFileSync(doc, "utf8");
    for (const claim of bannedClaims) {
      if (text.includes(claim)) {
        throw new Error(`Banned claim found in ${doc}: ${claim}`);
      }
    }
  }
}

function findLatestReport(): { dir: string; htmlPath: string; jsonPath: string; mtimeMs: number } | undefined {
  const reportRoot = resolve(process.cwd(), "reports");
  if (!existsSync(reportRoot)) return undefined;
  const candidates = readdirSync(reportRoot)
    .filter((name) => name.startsWith("run_"))
    .map((name) => {
      const dir = join(reportRoot, name);
      const htmlPath = join(dir, "index.html");
      return {
        dir,
        htmlPath,
        jsonPath: join(dir, "report.json"),
        mtimeMs: existsSync(htmlPath) ? statSync(htmlPath).mtimeMs : 0
      };
    })
    .filter((item) => item.mtimeMs > 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0];
}

function copyIntoPackage(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
