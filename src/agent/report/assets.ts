export function renderReportCss(): string {
  return `
:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --surface: #ffffff;
  --surface-muted: #eef2f6;
  --ink: #172026;
  --muted: #5f6b76;
  --line: #d9e0e7;
  --accent: #0d6b68;
  --accent-ink: #063f3e;
  --warn: #a76405;
  --fail: #a33535;
  --pass: #126944;
  --shadow: 0 10px 30px rgba(23, 32, 38, 0.08);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-width: 320px;
  background: var(--bg);
  color: var(--ink);
  letter-spacing: 0;
  overflow-x: hidden;
}

.report-shell {
  width: min(1440px, 100%);
  margin: 0 auto;
  padding: 28px;
}

.report-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 24px;
  align-items: start;
  padding: 22px 0 26px;
  border-bottom: 1px solid var(--line);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 2px solid var(--accent);
  color: var(--accent-ink);
  font-size: 17px;
  font-weight: 800;
}

.brand-name {
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.14;
  font-weight: 760;
}

h2 {
  margin: 0;
  font-size: 17px;
  line-height: 1.25;
  font-weight: 760;
}

h3 {
  margin: 0;
  font-size: 13px;
  line-height: 1.3;
  font-weight: 760;
}

p {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.55;
}

strong {
  font-weight: 760;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 12px;
  margin: 22px 0;
}

.metric {
  min-height: 92px;
  padding: 14px;
  border: 1px solid var(--line);
  background: var(--surface);
  box-shadow: var(--shadow);
}

.metric-label {
  display: block;
  margin-bottom: 8px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 720;
  text-transform: uppercase;
}

.metric-value {
  display: block;
  color: var(--ink);
  font-size: 23px;
  line-height: 1.15;
  font-weight: 760;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.status {
  display: inline-flex;
  min-width: 92px;
  justify-content: center;
  align-items: center;
  padding: 8px 12px;
  border: 1px solid currentColor;
  font-size: 12px;
  font-weight: 780;
  text-transform: uppercase;
}

.status-pass { color: var(--pass); }
.status-warn { color: var(--warn); }
.status-fail, .status-blocked { color: var(--fail); }

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(320px, 0.55fr);
  gap: 18px;
  align-items: start;
}

.stack {
  display: grid;
  gap: 18px;
  min-width: 0;
}

.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  min-width: 0;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  padding: 16px 18px;
  border-bottom: 1px solid var(--line);
}

.panel-body {
  padding: 18px;
}

.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--line);
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 560px;
}

th, td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
  font-size: 13px;
  line-height: 1.42;
  overflow-wrap: anywhere;
}

th {
  background: var(--surface-muted);
  color: #33404a;
  font-size: 11px;
  text-transform: uppercase;
}

tr:last-child td { border-bottom: 0; }

.list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.list li {
  padding: 10px 12px;
  border: 1px solid var(--line);
  background: #fbfcfd;
  font-size: 13px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.flag {
  display: grid;
  gap: 6px;
}

.flag-code {
  color: var(--accent-ink);
  font-size: 12px;
  font-weight: 760;
  overflow-wrap: anywhere;
}

.timeline {
  display: grid;
  gap: 0;
  max-height: 620px;
  overflow: auto;
  border: 1px solid var(--line);
}

.event {
  display: grid;
  grid-template-columns: 126px minmax(0, 1fr);
  gap: 12px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--line);
  background: #fff;
}

.event:last-child { border-bottom: 0; }

.event-phase {
  color: var(--accent-ink);
  font-size: 11px;
  font-weight: 780;
  overflow-wrap: anywhere;
}

.event-summary {
  font-size: 13px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.muted { color: var(--muted); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }

details {
  border: 1px solid var(--line);
  background: #fbfcfd;
}

summary {
  cursor: pointer;
  padding: 12px;
  font-size: 13px;
  font-weight: 740;
}

@media (max-width: 980px) {
  .report-shell { padding: 18px; }
  .report-header { grid-template-columns: 1fr; }
  .meta-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .layout { grid-template-columns: 1fr; }
}

@media (max-width: 620px) {
  h1 { font-size: 24px; }
  .meta-grid { grid-template-columns: 1fr; }
  .event { grid-template-columns: 1fr; }
  .panel-head { align-items: flex-start; flex-direction: column; }
  .panel-body { padding: 14px; }
  .metric { min-height: 0; }
  table { min-width: 520px; }
}
`;
}
