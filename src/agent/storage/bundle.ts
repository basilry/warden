import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { nowIso } from "../ids.ts";
import type { ApprovalRequest } from "../approval.ts";
import type { CapabilityJob } from "../jobs.ts";
import type { KnowledgeUnit, TraceEvent } from "../types.ts";
import { fileSize, readJson, readJsonl, safeJoin, sha256File, writeJson } from "./files.ts";
import type { StorageProvider } from "./types.ts";

export type BundleFileKind = "jobs" | "approvals" | "knowledge" | "trace" | "artifact";

export type BundleFileManifest = {
  path: string;
  kind: BundleFileKind;
  bytes: number;
  sha256: string;
  runId?: string;
  artifactName?: string;
  contentType?: string;
};

export type WardenBundleManifest = {
  schemaVersion: "warden.bundle.v1";
  runId: string;
  relatedRunIds: string[];
  exportedAt: string;
  files: BundleFileManifest[];
};

export type ExportRunBundleOptions = {
  runId: string;
  storage: StorageProvider;
  outputDir: string;
  relatedRunIds?: string[];
};

export type BundleIntegrityReport = {
  ok: boolean;
  checked: number;
  failures: string[];
};

export async function exportRunBundle(options: ExportRunBundleOptions): Promise<WardenBundleManifest> {
  const runIds = unique([options.runId, ...(options.relatedRunIds ?? [])]);
  mkdirSync(options.outputDir, { recursive: true });

  const jobs = (await options.storage.jobs.listJobs()).filter((job) => jobBelongsToRun(job, runIds));
  const approvals = (await options.storage.approvals.listApprovals()).filter((approval) => runIds.includes(approval.runId));
  const knowledge = await options.storage.knowledge.listKnowledgeUnits();
  const files: BundleFileManifest[] = [];

  writeBundleJson(options.outputDir, "jobs.json", "jobs", jobs, files);
  writeBundleJson(options.outputDir, "approvals.json", "approvals", approvals, files);
  writeBundleJson(options.outputDir, "knowledge.json", "knowledge", knowledge, files);

  for (const runId of runIds) {
    const trace = await options.storage.traces.listTraceEvents({ runId });
    if (trace.length === 0) continue;
    const relativePath = join("traces", `${runId}.jsonl`);
    const path = safeJoin(options.outputDir, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, trace.map((event) => JSON.stringify(event)).join("\n") + "\n", "utf8");
    files.push(createFileManifest(path, relativePath, "trace", { runId }));
  }

  for (const artifact of await options.storage.artifacts.listArtifacts()) {
    if (!runIds.includes(artifact.runId)) continue;
    const content = await options.storage.artifacts.readArtifact(artifact.runId, artifact.name);
    if (!content) continue;
    const relativePath = join("artifacts", artifact.runId, artifact.name);
    const path = safeJoin(options.outputDir, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    files.push(
      createFileManifest(path, relativePath, "artifact", {
        runId: artifact.runId,
        artifactName: artifact.name,
        contentType: artifact.contentType
      })
    );
  }

  const manifest: WardenBundleManifest = {
    schemaVersion: "warden.bundle.v1",
    runId: options.runId,
    relatedRunIds: runIds.filter((runId) => runId !== options.runId),
    exportedAt: nowIso(),
    files
  };
  writeJson(safeJoin(options.outputDir, "manifest.json"), manifest);
  return manifest;
}

export async function importRunBundle(bundleDir: string, storage: StorageProvider): Promise<WardenBundleManifest> {
  const manifest = readJson<WardenBundleManifest>(safeJoin(bundleDir, "manifest.json"));
  const integrity = verifyBundleIntegrity(bundleDir);
  if (!integrity.ok) {
    throw new Error(`Bundle integrity failed: ${integrity.failures.join("; ")}`);
  }

  for (const file of manifest.files) {
    const path = safeJoin(bundleDir, file.path);
    if (file.kind === "jobs") {
      for (const job of readJson<CapabilityJob[]>(path)) await storage.jobs.saveJob(job);
    } else if (file.kind === "approvals") {
      for (const approval of readJson<ApprovalRequest[]>(path)) await storage.approvals.saveApproval(approval);
    } else if (file.kind === "knowledge") {
      for (const unit of readJson<KnowledgeUnit[]>(path)) await storage.knowledge.saveKnowledgeUnit(unit);
    } else if (file.kind === "trace") {
      for (const event of readJsonl<TraceEvent>(path)) await storage.traces.appendTraceEvent(event);
    } else if (file.kind === "artifact" && file.runId && file.artifactName) {
      await storage.artifacts.writeArtifact({
        runId: file.runId,
        name: file.artifactName,
        content: readFileSync(path),
        contentType: file.contentType
      });
    }
  }

  return manifest;
}

export function verifyBundleIntegrity(bundleDir: string): BundleIntegrityReport {
  const manifestPath = safeJoin(bundleDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return { ok: false, checked: 0, failures: ["manifest.json is missing"] };
  }

  const manifest = readJson<WardenBundleManifest>(manifestPath);
  const failures: string[] = [];
  for (const file of manifest.files) {
    const path = safeJoin(bundleDir, file.path);
    if (!existsSync(path)) {
      failures.push(`${file.path} is missing`);
      continue;
    }
    const actualHash = sha256File(path);
    if (actualHash !== file.sha256) {
      failures.push(`${file.path} hash mismatch`);
    }
    const actualSize = fileSize(path);
    if (actualSize !== file.bytes) {
      failures.push(`${file.path} size mismatch`);
    }
  }

  return {
    ok: failures.length === 0,
    checked: manifest.files.length,
    failures
  };
}

function writeBundleJson(
  bundleDir: string,
  relativePath: string,
  kind: BundleFileKind,
  value: unknown,
  files: BundleFileManifest[]
): void {
  const path = safeJoin(bundleDir, relativePath);
  writeJson(path, value);
  files.push(createFileManifest(path, relativePath, kind));
}

function createFileManifest(
  path: string,
  relativePath: string,
  kind: BundleFileKind,
  extras: Partial<BundleFileManifest> = {}
): BundleFileManifest {
  return {
    path: relativePath,
    kind,
    bytes: fileSize(path),
    sha256: sha256File(path),
    ...extras
  };
}

function jobBelongsToRun(job: CapabilityJob, runIds: string[]): boolean {
  return Boolean(job.currentRunId && runIds.includes(job.currentRunId)) || job.history.some((event) => Boolean(event.ref && runIds.includes(event.ref)));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
