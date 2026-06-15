import { nowIso } from "../ids.ts";
import type { ApprovalRequest } from "../approval.ts";
import type { CapabilityJob } from "../jobs.ts";
import type { KnowledgeUnit, TraceEvent } from "../types.ts";
import { sha256Bytes, toBytes } from "./files.ts";
import type { ArtifactWriteInput, StorageFilter, StorageProvider, StoredArtifact } from "./types.ts";

export function createMemoryStorageProvider(): StorageProvider {
  const jobs = new Map<string, CapabilityJob>();
  const approvals = new Map<string, ApprovalRequest>();
  const knowledge = new Map<string, KnowledgeUnit>();
  const traces: TraceEvent[] = [];
  const artifacts = new Map<string, { metadata: StoredArtifact; content: Uint8Array }>();

  return {
    kind: "memory",
    jobs: {
      async saveJob(job) {
        jobs.set(job.jobId, cloneJson(job));
      },
      async loadJob(jobId) {
        return cloneMaybe(jobs.get(jobId));
      },
      async listJobs(filter) {
        return [...jobs.values()].filter((job) => matchesJobFilter(job, filter)).map(cloneJson);
      }
    },
    approvals: {
      async saveApproval(approval) {
        approvals.set(approval.id, cloneJson(approval));
      },
      async loadApproval(id) {
        return cloneMaybe(approvals.get(id));
      },
      async listApprovals(filter) {
        return [...approvals.values()]
          .filter((approval) => !filter?.runId || approval.runId === filter.runId)
          .map(cloneJson);
      }
    },
    knowledge: {
      async saveKnowledgeUnit(unit) {
        knowledge.set(unit.id, cloneJson(unit));
      },
      async loadKnowledgeUnit(id) {
        return cloneMaybe(knowledge.get(id));
      },
      async listKnowledgeUnits() {
        return [...knowledge.values()].map(cloneJson);
      }
    },
    traces: {
      async appendTraceEvent(event) {
        traces.push(cloneJson(event));
      },
      async listTraceEvents(filter) {
        return traces.filter((event) => !filter?.runId || event.runId === filter.runId).map(cloneJson);
      }
    },
    artifacts: {
      async writeArtifact(input) {
        const content = toBytes(input.content);
        const metadata: StoredArtifact = {
          runId: input.runId,
          name: input.name,
          size: content.byteLength,
          sha256: sha256Bytes(content),
          contentType: input.contentType,
          updatedAt: nowIso()
        };
        artifacts.set(artifactKey(input.runId, input.name), { metadata, content });
        return cloneJson(metadata);
      },
      async readArtifact(runId, name) {
        return artifacts.get(artifactKey(runId, name))?.content;
      },
      async listArtifacts(filter) {
        return [...artifacts.values()]
          .map((entry) => entry.metadata)
          .filter((artifact) => !filter?.runId || artifact.runId === filter.runId)
          .map(cloneJson);
      }
    }
  };
}

function matchesJobFilter(job: CapabilityJob, filter?: StorageFilter): boolean {
  if (!filter?.runId) return true;
  return job.currentRunId === filter.runId || job.history.some((event) => event.ref === filter.runId);
}

function artifactKey(runId: string, name: string): string {
  return `${runId}/${name}`;
}

function cloneMaybe<T>(value: T | undefined): T | undefined {
  return value ? cloneJson(value) : undefined;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
