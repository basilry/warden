import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWardenConfig } from "../src/agent/config.ts";
import { runP1Workflow, type P1RunResult } from "../src/agent/p1-runner.ts";
import { buildWardenReport } from "../src/agent/report/build-report.ts";
import { renderHtmlReport } from "../src/agent/report/html-report.ts";
import {
  createBuiltInNormalRegressionCase,
  loadRegressionCases,
  runRegressionSuite
} from "../src/agent/regression.ts";
import { exportRunBundle, importRunBundle, verifyBundleIntegrity } from "../src/agent/storage/bundle.ts";
import { createStorageProvider } from "../src/agent/storage/provider.ts";
import type { StorageProvider } from "../src/agent/storage/types.ts";
import { runTeamWorkflow } from "../src/agent/team-runner.ts";
import type { TeamRunResult } from "../src/agent/types.ts";

const userRequest =
  "가상 방산 공급망 핵심 부품 수입 급감의 원인을 분석하고, 저장 가능한 감사 번들까지 만들어줘.";

const config = loadWardenConfig({
  ...process.env,
  WARDEN_STORAGE: process.env.WARDEN_STORAGE ?? "jsonl",
  WARDEN_STORAGE_DIR: process.env.WARDEN_STORAGE_DIR ?? "data/p4-demo"
});
const storage = createStorageProvider(config.storage);

const p1Result = await runP1Workflow(userRequest);
const p2Result = await runTeamWorkflow(userRequest, {
  withSourceVet: true,
  fixtureVariant: "normal"
});

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(here, "../fixtures/regression");
const regressionResults = await runRegressionSuite([createBuiltInNormalRegressionCase(), ...loadRegressionCases(fixtureDir)]);
const report = buildWardenReport({
  teamResult: p2Result,
  p1Result,
  regressionResults
});
const html = renderHtmlReport(report);

await persistSnapshot(storage, p1Result, p2Result, report.runId, html, JSON.stringify(report, null, 2));

const restarted = createStorageProvider(config.storage);
const restored = {
  jobs: await restarted.jobs.listJobs({ runId: report.runId }),
  approvals: await restarted.approvals.listApprovals({ runId: p1Result.pendingApprovals[0]?.runId }),
  knowledge: await restarted.knowledge.listKnowledgeUnits(),
  trace: await restarted.traces.listTraceEvents({ runId: p2Result.run.id }),
  artifacts: await restarted.artifacts.listArtifacts({ runId: report.runId })
};

const bundleDir = resolve(config.storage.rootDir, "bundles", report.runId);
const manifest = await exportRunBundle({
  runId: report.runId,
  storage: restarted,
  outputDir: bundleDir,
  relatedRunIds: [p1Result.p0Result.run.id, ...p1Result.pendingApprovals.map((approval) => approval.runId)]
});
const integrity = verifyBundleIntegrity(bundleDir);
const imported = createStorageProvider("memory");
await importRunBundle(bundleDir, imported);
const importedTrace = await imported.traces.listTraceEvents({ runId: p2Result.run.id });

console.log("WARDEN P4 Persistence Demo");
console.log("==========================");
console.log(`Storage: ${config.storage.kind} (${config.storage.rootDir})`);
console.log(`Run: ${report.runId}`);
console.log(`Restart load: jobs=${restored.jobs.length}, approvals=${restored.approvals.length}, knowledge=${restored.knowledge.length}, trace=${restored.trace.length}, artifacts=${restored.artifacts.length}`);
console.log(`Bundle: ${bundleDir}`);
console.log(`Bundle files: ${manifest.files.length}, integrity=${integrity.ok ? "ok" : "failed"}`);
console.log(`Import check: trace=${importedTrace.length}`);

if (
  restored.jobs.length === 0 ||
  restored.approvals.length === 0 ||
  restored.knowledge.length === 0 ||
  restored.trace.length === 0 ||
  restored.artifacts.length < 2 ||
  !integrity.ok ||
  importedTrace.length === 0
) {
  process.exitCode = 1;
}

async function persistSnapshot(
  storage: StorageProvider,
  p1Result: P1RunResult,
  teamResult: TeamRunResult,
  reportRunId: string,
  html: string,
  reportJson: string
): Promise<void> {
  await storage.jobs.saveJob({
    ...p1Result.job,
    currentRunId: reportRunId
  });
  for (const approval of p1Result.pendingApprovals) {
    await storage.approvals.saveApproval(approval);
  }
  for (const unit of p1Result.p0Result.outputs.knowledgeUnits ?? []) {
    await storage.knowledge.saveKnowledgeUnit(unit);
  }
  for (const unit of teamResult.outputs.knowledgeUnits ?? []) {
    await storage.knowledge.saveKnowledgeUnit(unit);
  }
  for (const event of p1Result.p0Result.trace) {
    await storage.traces.appendTraceEvent(event);
  }
  for (const event of teamResult.trace) {
    await storage.traces.appendTraceEvent(event);
  }
  await storage.artifacts.writeArtifact({
    runId: reportRunId,
    name: "index.html",
    content: html,
    contentType: "text/html; charset=utf-8"
  });
  await storage.artifacts.writeArtifact({
    runId: reportRunId,
    name: "report.json",
    content: reportJson,
    contentType: "application/json"
  });
}
