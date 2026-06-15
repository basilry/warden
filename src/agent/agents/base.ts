import type { Agent, AgentContext, AgentResult, AgentTask } from "../types.ts";

export async function runAgentTask<I, O>(
  agent: Agent<I, O>,
  task: AgentTask,
  context: AgentContext,
  input: I
): Promise<AgentResult<O>> {
  context.trace.record({
    phase: "task_started",
    actor: agent.role,
    taskId: task.id,
    summary: `${agent.role} started: ${task.goal}`,
    payload: { input }
  });

  try {
    const result = await agent.run(task, context, input);
    context.trace.record({
      phase: result.status === "failed" ? "failure" : "agent_output",
      actor: agent.role,
      taskId: task.id,
      summary: result.summary,
      payload: result.output ?? result.errors
    });

    for (const handoff of result.handoffs ?? []) {
      context.trace.record({
        phase: "handoff",
        actor: agent.role,
        taskId: task.id,
        ref: `${handoff.from}->${handoff.to}`,
        summary: handoff.summary,
        payload: handoff
      });
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.trace.record({
      phase: "failure",
      actor: agent.role,
      taskId: task.id,
      summary: message
    });
    return {
      status: "failed",
      summary: message,
      errors: [message],
      failureClass: "agent_exception"
    };
  }
}

export function createHandoff(from: Agent["role"], to: Agent["role"], taskId: string, artifactRefs: string[], summary: string) {
  return { from, to, taskId, artifactRefs, summary };
}
