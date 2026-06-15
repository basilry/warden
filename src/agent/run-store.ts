import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderAuditBriefMarkdown } from "./brief.ts";
import { writeTraceJsonl } from "./audit.ts";
import type { TeamRunResult } from "./types.ts";

export function writeRunArtifacts(result: TeamRunResult, baseDir = ".warden-runs"): void {
  const dir = join(baseDir, result.run.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.json"), JSON.stringify(result.run, null, 2), "utf8");
  writeTraceJsonl(join(dir, "trace.jsonl"), result.trace);

  if (result.outputs.brief) {
    writeFileSync(
      join(dir, "brief.md"),
      result.markdown ??
        renderAuditBriefMarkdown(result.outputs.brief, {
          ach: result.outputs.ach,
          verification: result.outputs.verification
        }),
      "utf8"
    );
  }
}
