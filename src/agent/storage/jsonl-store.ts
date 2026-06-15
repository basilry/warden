import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { nowIso } from "../ids.ts";
import type { ApprovalRequest } from "../approval.ts";
import type { CapabilityJob } from "../jobs.ts";
import type { KnowledgeUnit, TraceEvent } from "../types.ts";
import {
  appendJsonl,
  dedupeByLatest,
  ensureStorageDirs,
  readJsonl,
  safeJoin,
  sha256Bytes,
  toBytes
} from "./files.ts";
import type { ArtifactWriteInput, StorageFilter, StorageProvider, StoredArtifact } from "./types.ts";

export function createJsonlStorageProvider(rootDir: string): StorageProvider {
  ensureStorageDirs(rootDir);

  return {
    kind: "jsonl",
    jobs: {
      async saveJob(job) {
        appendJsonl(safeJoin(rootDir, "jobs.jsonl"), job);
      },
      async loadJob(jobId) {
        return latestBy(readJsonl<CapabilityJob>(safeJoin(rootDir, "jobs.jsonl")), (job) => job.jobId).get(jobId);
      },
      async listJobs(filter) {
        return dedupeByLatest(readJsonl<CapabilityJob>(safeJoin(rootDir, "jobs.jsonl")), (job) => job.jobId).filter((job) =>
          matchesJobFilter(job, filter)
        );
      }
    },
    approvals: {
      async saveApproval(approval) {
        appendJsonl(safeJoin(rootDir, "approvals.jsonl"), approval);
      },
      async loadApproval(id) {
        return latestBy(readJsonl<ApprovalRequest>(safeJoin(rootDir, "approvals.jsonl")), (approval) => approval.id).get(id);
      },
      async listApprovals(filter) {
        return dedupeByLatest(readJsonl<ApprovalRequest>(safeJoin(rootDir, "approvals.jsonl")), (approval) => approval.id).filter(
          (approval) => !filter?.runId || approval.runId === filter.runId
        );
      }
    },
    knowledge: {
      async saveKnowledgeUnit(unit) {
        appendJsonl(safeJoin(rootDir, "knowledge.jsonl"), unit);
      },
      async loadKnowledgeUnit(id) {
        return latestBy(readJsonl<KnowledgeUnit>(safeJoin(rootDir, "knowledge.jsonl")), (unit) => unit.id).get(id);
      },
      async listKnowledgeUnits() {
        return dedupeByLatest(readJsonl<KnowledgeUnit>(safeJoin(rootDir, "knowledge.jsonl")), (unit) => unit.id);
      }
    },
    traces: {
      async appendTraceEvent(event) {
        appendJsonl(safeJoin(rootDir, "traces", `${event.runId}.jsonl`), event);
      },
      async listTraceEvents(filter) {
        if (filter?.runId) {
          return readJsonl<TraceEvent>(safeJoin(rootDir, "traces", `${filter.runId}.jsonl`));
        }
        const traceDir = safeJoin(rootDir, "traces");
        if (!existsSync(traceDir)) return [];
        return readdirSync(traceDir)
          .filter((file) => file.endsWith(".jsonl"))
          .sort()
          .flatMap((file) => readJsonl<TraceEvent>(safeJoin(traceDir, file)));
      }
    },
    artifacts: {
      async writeArtifact(input) {
        const content = toBytes(input.content);
        const path = safeJoin(rootDir, "artifacts", input.runId, input.name);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
        const metadata: StoredArtifact = {
          runId: input.runId,
          name: input.name,
          size: content.byteLength,
          sha256: sha256Bytes(content),
          contentType: input.contentType,
          updatedAt: nowIso(),
          path
        };
        appendJsonl(safeJoin(rootDir, "artifacts.jsonl"), metadata);
        return metadata;
      },
      async readArtifact(runId, name) {
        const path = safeJoin(rootDir, "artifacts", runId, name);
        return existsSync(path) ? readFileSync(path) : undefined;
      },
      async listArtifacts(filter) {
        return dedupeByLatest(
          readJsonl<StoredArtifact>(safeJoin(rootDir, "artifacts.jsonl")),
          (artifact) => `${artifact.runId}/${artifact.name}`
        ).filter((artifact) => !filter?.runId || artifact.runId === filter.runId);
      }
    }
  };
}

function latestBy<T>(items: T[], key: (item: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(key(item), item);
  }
  return map;
}

function matchesJobFilter(job: CapabilityJob, filter?: StorageFilter): boolean {
  if (!filter?.runId) return true;
  return job.currentRunId === filter.runId || job.history.some((event) => event.ref === filter.runId);
}
