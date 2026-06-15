import type { Agent, TeamPlan } from "../types.ts";

export function createSupervisorAgent(): Agent<string, TeamPlan> {
  return {
    role: "supervisor",
    async run(task, _context, input) {
      const plan: TeamPlan = {
        runId: task.runId,
        objective: input,
        tasks: []
      };
      return {
        status: "succeeded",
        output: plan,
        summary:
          "Supervisor selected the fixed P0 workflow: case framing, evidence curation, ACH analysis, verification, briefing."
      };
    }
  };
}
