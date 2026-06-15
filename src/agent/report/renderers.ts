import type { AchPanel, ApprovalPanel, JobPanel, PolicyPanel, RegressionPanel, SourceVetPanel, TracePanel } from "./types.ts";

export function renderKeyValue(label: string, value: string | number | undefined): string {
  return `<div class="metric"><span class="metric-label">${escapeHtml(label)}</span><span class="metric-value">${escapeHtml(formatDisplayValue(value))}</span></div>`;
}

export function renderJobPanel(panel: JobPanel | undefined): string {
  if (!panel) return renderPanel("Job History", "<p>No P1 job context attached.</p>");
  return renderPanel(
    "Job History",
    [
      `<p><span class="mono">${escapeHtml(panel.jobId)}</span> · ${escapeHtml(panel.status)}</p>`,
      renderList(
        panel.history.map((item) =>
          `<strong>${escapeHtml(item.status)}</strong> · ${escapeHtml(item.summary)}${item.ref ? ` <span class="mono">${escapeHtml(item.ref)}</span>` : ""}<br><span class="muted mono">${escapeHtml(item.at)}</span>`
        ),
        false
      ),
      `<h3>Tool Catalog</h3>${renderList(panel.toolCatalog)}`,
      `<h3>Knowledge Summary</h3>${renderList(panel.knowledgeSummary)}`
    ].join("\n")
  );
}

export function renderAchPanel(panel: AchPanel): string {
  return renderPanel(
    "ACH Analysis",
    [
      renderList(panel.survivors.map((item) => `Survivor: ${item}`)),
      panel.rfi ? `<p>${escapeHtml(panel.rfi)}</p>` : "",
      renderTable(
        ["Hypothesis", "Contradictions", "Support", "Neutral", "Status"],
        panel.ranking.map((row) => [
          row.hypothesis,
          String(row.contradictions),
          String(row.support),
          String(row.neutral),
          row.status
        ])
      ),
      `<details><summary>ACH Matrix</summary>${renderMatrix(panel.matrixRows)}</details>`,
      `<details><summary>Diagnosticity</summary>${renderTable(
        ["Evidence", "Diagnosticity", "Note"],
        panel.diagnosticity.map((row) => [row.evidence, String(row.diagnosticity), row.note])
      )}</details>`
    ].join("\n")
  );
}

export function renderSourceVetPanel(panel: SourceVetPanel | undefined): string {
  if (!panel) return renderPanel("SourceVet", "<p>SourceVet was not run for this report.</p>");
  return renderPanel(
    "SourceVet",
    [
      `<div class="meta-grid">${renderKeyValue("Status", panel.status)}${renderKeyValue("Sources", panel.sourceCount)}${renderKeyValue("Claims", panel.claimCount)}${renderKeyValue("Fabrication Risk", panel.fabricationRisk)}</div>`,
      panel.flags.length > 0
        ? renderList(
            panel.flags.map(
              (flag) =>
                `<span class="flag"><span class="flag-code">${escapeHtml(flag.code)} · ${escapeHtml(flag.severity)}</span>${escapeHtml(flag.summary)}</span>`
            ),
            false
          )
        : "<p>No SourceVet risk flags.</p>",
      `<h3>Recommendations</h3>${renderList(panel.recommendations)}`
    ].join("\n")
  );
}

export function renderPolicyPanel(panel: PolicyPanel): string {
  return renderPanel(
    "Policy Decisions",
    [
      panel.summary ? `<p>${escapeHtml(panel.summary)}</p>` : "",
      `<div class="meta-grid">${Object.entries(panel.counts)
        .map(([key, value]) => renderKeyValue(key, value))
        .join("")}</div>`,
      renderList(
        panel.decisions.map(
          (decision) =>
            `<strong>${escapeHtml(decision.ref ?? "policy")}</strong> · ${escapeHtml(decision.summary)}<br><span class="muted mono">${escapeHtml(decision.ts)}</span>`
        ),
        false
      )
    ].join("\n")
  );
}

export function renderApprovalPanel(panel: ApprovalPanel): string {
  return renderPanel(
    "Approval Queue",
    panel.approvals.length > 0
      ? renderList(
          panel.approvals.map(
            (approval) =>
              `<strong>${escapeHtml(approval.action.name)}</strong> · ${escapeHtml(approval.decision.risk)} · ${escapeHtml(approval.status)}<br><span class="mono">${escapeHtml(approval.id)}</span><br>${escapeHtml(approval.reason ?? "")}`
          ),
          false
        )
      : "<p>No pending approvals.</p>"
  );
}

export function renderTraceTimelinePanel(panel: TracePanel): string {
  return renderPanel(
    "Trace Timeline",
    `<div class="timeline">${panel.events
      .map(
        (event) =>
          `<div class="event"><div class="event-phase">${escapeHtml(event.phase)}${event.ref ? `<br><span class="muted">${escapeHtml(event.ref)}</span>` : ""}</div><div class="event-summary">${escapeHtml(event.summary)}<br><span class="muted mono">${escapeHtml(event.ts)}</span></div></div>`
      )
      .join("")}</div>`
  );
}

export function renderRegressionPanel(panel: RegressionPanel | undefined): string {
  if (!panel) return renderPanel("Regression", "<p>No regression summary attached.</p>");
  return renderPanel(
    "Regression",
    [
      `<div class="meta-grid">${renderKeyValue("Passed", `${panel.passed}/${panel.total}`)}</div>`,
      renderList(
        panel.results.map(
          (result) =>
            `<strong>${escapeHtml(result.id)}</strong> · ${escapeHtml(result.status)} · expected=${escapeHtml(result.expectedStatus)} actual=${escapeHtml(result.actualStatus)}<br><span class="muted">${escapeHtml(result.checks.join(", "))}</span>`
        ),
        false
      )
    ].join("\n")
  );
}

export function renderPanel(title: string, body: string): string {
  return `<section class="panel"><div class="panel-head"><h2>${escapeHtml(title)}</h2></div><div class="panel-body">${body}</div></section>`;
}

export function renderTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "<p>No rows.</p>";
  return `<div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

export function renderList(items: string[], escapeItems = true): string {
  if (items.length === 0) return "<p>None.</p>";
  return `<ul class="list">${items.map((item) => `<li>${escapeItems ? escapeHtml(item) : item}</li>`).join("")}</ul>`;
}

function renderMatrix(rows: string[][]): string {
  if (rows.length === 0) return "<p>No matrix.</p>";
  const [headers, ...body] = rows;
  return renderTable(headers, body);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDisplayValue(value: string | number | undefined): string {
  if (value === undefined) return "n/a";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    return text.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
  }
  return text;
}
