import type { ApprovalRequest } from "../approval.ts";
import type { CapabilityJob } from "../jobs.ts";
import type { KnowledgeUnit, TraceEvent } from "../types.ts";

export type StorageProviderKind = "memory" | "jsonl" | "sqlite";

export type StorageFilter = {
  runId?: string;
};

export type StoredArtifact = {
  runId: string;
  name: string;
  size: number;
  sha256: string;
  contentType?: string;
  updatedAt: string;
  path?: string;
};

export type ArtifactWriteInput = {
  runId: string;
  name: string;
  content: string | Uint8Array;
  contentType?: string;
};

export type JobRepository = {
  saveJob(job: CapabilityJob): Promise<void>;
  loadJob(jobId: string): Promise<CapabilityJob | undefined>;
  listJobs(filter?: StorageFilter): Promise<CapabilityJob[]>;
};

export type ApprovalRepository = {
  saveApproval(approval: ApprovalRequest): Promise<void>;
  loadApproval(id: string): Promise<ApprovalRequest | undefined>;
  listApprovals(filter?: StorageFilter): Promise<ApprovalRequest[]>;
};

export type KnowledgeRepository = {
  saveKnowledgeUnit(unit: KnowledgeUnit): Promise<void>;
  loadKnowledgeUnit(id: string): Promise<KnowledgeUnit | undefined>;
  listKnowledgeUnits(): Promise<KnowledgeUnit[]>;
};

export type TraceRepository = {
  appendTraceEvent(event: TraceEvent): Promise<void>;
  listTraceEvents(filter?: StorageFilter): Promise<TraceEvent[]>;
};

export type ArtifactRepository = {
  writeArtifact(input: ArtifactWriteInput): Promise<StoredArtifact>;
  readArtifact(runId: string, name: string): Promise<Uint8Array | undefined>;
  listArtifacts(filter?: StorageFilter): Promise<StoredArtifact[]>;
};

export type StorageProvider = {
  kind: StorageProviderKind;
  jobs: JobRepository;
  approvals: ApprovalRepository;
  knowledge: KnowledgeRepository;
  traces: TraceRepository;
  artifacts: ArtifactRepository;
};
