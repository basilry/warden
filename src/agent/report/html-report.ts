import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderReportCss } from "./assets.ts";
import {
  escapeHtml,
  renderAchPanel,
  renderApprovalPanel,
  renderJobPanel,
  renderKeyValue,
  renderPanel,
  renderPolicyPanel,
  renderRegressionPanel,
  renderSourceVetPanel,
  renderTraceTimelinePanel
} from "./renderers.ts";
import type { ReportArtifact, WardenReport } from "./types.ts";

export function renderHtmlReport(report: WardenReport): string {
  const body = [
    renderHeader(report),
    `<main class="layout"><div class="stack">${[
      renderPanel("Case Summary", renderCaseBody(report)),
      renderAchPanel(report.achPanel),
      renderTraceTimelinePanel(report.tracePanel)
    ].join("")}</div><aside class="stack">${[
      renderJobPanel(report.jobPanel),
      renderApprovalPanel(report.approvalPanel),
      renderPolicyPanel(report.policyPanel),
      renderSourceVetPanel(report.sourceVetPanel),
      renderRegressionPanel(report.regressionPanel),
      renderResidualRisk(report.residualRisk)
    ].join("")}</aside></main>`
  ].join("\n");
  return renderReportShell(report, body);
}

export function renderReportShell(report: WardenReport, body: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report.title)} · ${escapeHtml(report.runId)}</title>
  <style>${renderReportCss()}</style>
</head>
<body>
  <div class="report-shell">${body}</div>
</body>
</html>
`;
}

export function writeReportArtifacts(outputDir: string, report: WardenReport): ReportArtifact {
  mkdirSync(outputDir, { recursive: true });
  const htmlPath = join(outputDir, "index.html");
  writeFileSync(htmlPath, renderHtmlReport(report), "utf8");
  writeFileSync(join(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  return {
    reportId: report.reportId,
    runId: report.runId,
    outputDir,
    htmlPath
  };
}

export function resolveReportOutputDir(runId: string, baseDir = "reports"): string {
  return resolve(process.cwd(), baseDir, runId);
}

export function printReportLocation(artifact: ReportArtifact): string {
  return `Report written: ${artifact.htmlPath}`;
}

function renderHeader(report: WardenReport): string {
  return `<header class="report-header">
  <div>
    <div class="brand"><div class="brand-mark">W</div><div class="brand-name">WARDEN</div></div>
    <h1>${escapeHtml(report.title)}</h1>
    <p>${escapeHtml(report.casePanel.objective)}</p>
  </div>
  <div class="status status-${escapeHtml(report.status)}">${escapeHtml(report.status)}</div>
</header>
<section class="meta-grid">
  ${renderKeyValue("Run", report.runId)}
  ${renderKeyValue("Generated", report.generatedAt)}
  ${renderKeyValue("Verification", report.casePanel.verificationStatus ?? "n/a")}
  ${renderKeyValue("Approvals", report.approvalPanel.pendingCount)}
</section>`;
}

function renderCaseBody(report: WardenReport): string {
  return [
    `<div class="meta-grid">${[
      renderKeyValue("Run Status", report.casePanel.runStatus),
      renderKeyValue("Created", report.casePanel.createdAt),
      renderKeyValue("Completed", report.casePanel.completedAt ?? "running"),
      renderKeyValue("Trace Events", report.tracePanel.eventCount)
    ].join("")}</div>`,
    report.casePanel.question ? `<p>${escapeHtml(report.casePanel.question)}</p>` : "",
    report.achPanel.survivors.length > 0
      ? `<h3>Survivors</h3><p>${escapeHtml(report.achPanel.survivors.join(", "))}</p>`
      : ""
  ].join("\n");
}

function renderResidualRisk(risks: string[]): string {
  return renderPanel(
    "Residual Risk",
    risks.length > 0 ? `<ul class="list">${risks.map((risk) => `<li>${escapeHtml(risk)}</li>`).join("")}</ul>` : "<p>No residual risk recorded.</p>"
  );
}

