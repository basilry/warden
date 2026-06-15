import { createTraceRecorder } from "../audit.ts";
import { newId, nowIso } from "../ids.ts";
import { createPolicyEngine, formatPolicyDecision } from "../policy.ts";
import type {
  Agent,
  AgentContext,
  AgentResult,
  AgentTask,
  KnowledgeUnit,
  ToolAction,
  TraceEvent,
  TraceSummary
} from "../types.ts";
import type { SourceReview } from "../sourcevet-types.ts";
import { createSourceVetLocalTool } from "../tools/sourcevet-local.ts";
import { createHandoff, runAgentTask } from "./base.ts";

export type SourceVetReviewerInput = {
  units: KnowledgeUnit[];
  scenarioId?: string;
  minIndependentSources?: number;
};

export type SourceVetReviewerRunResult = {
  result: AgentResult<SourceReview>;
  review?: SourceReview;
  trace: TraceEvent[];
  traceSummary: TraceSummary;
};

export function createSourceVetReviewerAgent(): Agent<SourceVetReviewerInput, SourceReview> {
  return {
    role: "sourcevet_reviewer",
    async run(task, context, input) {
      if (!Array.isArray(input.units) || input.units.length === 0) {
        return {
          status: "failed",
          summary: "SourceVet review requires at least one KnowledgeUnit.",
          errors: ["SourceVet review requires at least one KnowledgeUnit."],
          failureClass: "missing_source_units"
        };
      }

      const tool = createSourceVetLocalTool();
      const action = createAction("review_sources", "Source Vet", "WRITE", {
        scenarioId: input.scenarioId,
        unitIds: input.units.map((unit) => unit.id),
        minIndependentSources: input.minIndependentSources
      });
      const policyContext = { runId: context.runId, taskId: task.id, role: "sourcevet_reviewer" as const };
      const decision = context.policy.evaluate(action, policyContext);
      context.trace.record({
        phase: "policy_decision",
        actor: "policy",
        taskId: task.id,
        ref: action.name,
        summary: formatPolicyDecision(action, decision),
        payload: decision
      });
      context.policy.assertAllowed(decision);

      context.trace.record({
        phase: "tool_call",
        actor: "tool",
        taskId: task.id,
        ref: action.name,
        summary: `Invoking ${action.server}:${action.name}.`,
        payload: action
      });
      const review = tool.reviewKnowledgeUnits(input.units, { minIndependentSources: input.minIndependentSources });
      context.trace.record({
        phase: "tool_result",
        actor: "tool",
        taskId: task.id,
        ref: action.name,
        summary: `SourceVet review ${review.id} completed with status ${review.status}.`,
        payload: review
      });

      return {
        status: "succeeded",
        output: review,
        summary: `SourceVet reviewed ${review.sourceCount} source(s), ${review.claimCount} claim(s), status=${review.status}.`,
        handoffs: [
          createHandoff(
            "sourcevet_reviewer",
            "verifier",
            task.id,
            ["source-review"],
            "Source review ready for verification and integration gates."
          )
        ]
      };
    }
  };
}

export async function runSourceVetReviewer(
  input: SourceVetReviewerInput,
  context?: AgentContext
): Promise<SourceVetReviewerRunResult> {
  const runId = context?.runId ?? newId("svrun");
  const localContext: AgentContext =
    context ?? {
      runId,
      trace: createTraceRecorder(runId),
      policy: createPolicyEngine(),
      options: {}
    };
  const task: AgentTask = {
    id: newId("task"),
    runId,
    role: "sourcevet_reviewer",
    goal: "Run deterministic local SourceVet review.",
    input,
    status: "queued",
    dependsOn: [],
    createdAt: nowIso()
  };

  if (!context) {
    localContext.trace.record({
      phase: "run_started",
      actor: "system",
      summary: `SourceVet standalone run started${input.scenarioId ? `: ${input.scenarioId}` : "."}`,
      payload: { scenarioId: input.scenarioId, unitCount: input.units.length }
    });
    localContext.trace.record({
      phase: "task_created",
      actor: "system",
      taskId: task.id,
      summary: task.goal,
      payload: task
    });
  }

  const result = await runAgentTask(createSourceVetReviewerAgent(), task, localContext, input);

  if (!context) {
    localContext.trace.record({
      phase: "run_finished",
      actor: "system",
      summary: `SourceVet standalone run ${result.status}.`,
      payload: { status: result.status, reviewStatus: result.output?.status }
    });
  }

  return {
    result,
    review: result.output,
    trace: localContext.trace.getEvents(),
    traceSummary: localContext.trace.summarize()
  };
}

function createAction(name: string, capability: string, risk: ToolAction["risk"], input: unknown): ToolAction {
  return {
    name,
    capability,
    server: "warden",
    risk,
    input
  };
}
