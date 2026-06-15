import { newId, nowIso } from "./ids.ts";

export type JobStatus = "queued" | "running" | "waiting_approval" | "succeeded" | "failed";

export type JobHistoryEvent = {
  ts: string;
  status: JobStatus;
  summary: string;
  ref?: string;
};

export type CapabilityJob = {
  jobId: string;
  capability: string;
  status: JobStatus;
  currentRunId?: string;
  input: unknown;
  history: JobHistoryEvent[];
  createdAt: string;
  updatedAt: string;
};

export type JobStore = {
  createJob(capability: string, input: unknown): CapabilityJob;
  updateJobStatus(jobId: string, status: JobStatus, summary: string, ref?: string): CapabilityJob;
  appendJobHistory(jobId: string, event: Omit<JobHistoryEvent, "ts">): void;
  getJob(jobId: string): CapabilityJob | undefined;
  listJobs(): CapabilityJob[];
};

export function createJobStore(): JobStore {
  const jobs = new Map<string, CapabilityJob>();

  return {
    createJob(capability, input) {
      const now = nowIso();
      const job: CapabilityJob = {
        jobId: newId("job"),
        capability,
        status: "queued",
        input,
        history: [{ ts: now, status: "queued", summary: `Queued ${capability}.` }],
        createdAt: now,
        updatedAt: now
      };
      jobs.set(job.jobId, job);
      return job;
    },
    updateJobStatus(jobId, status, summary, ref) {
      const job = mustGet(jobId);
      const ts = nowIso();
      job.status = status;
      job.updatedAt = ts;
      job.history.push({ ts, status, summary, ref });
      return job;
    },
    appendJobHistory(jobId, event) {
      const job = mustGet(jobId);
      job.history.push({ ts: nowIso(), ...event });
      job.updatedAt = nowIso();
    },
    getJob(jobId) {
      return jobs.get(jobId);
    },
    listJobs() {
      return [...jobs.values()];
    }
  };

  function mustGet(jobId: string): CapabilityJob {
    const job = jobs.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    return job;
  }
}

export function renderJobHistory(job: CapabilityJob): string {
  return job.history.map((event) => `- ${event.status}: ${event.summary}${event.ref ? ` [${event.ref}]` : ""}`).join("\n");
}
