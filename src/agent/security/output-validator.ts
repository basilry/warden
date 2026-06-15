import type { PolicyDecision } from "../types.ts";

export type AuthoritySnapshot = {
  achSurvivors?: string[];
  achRanking?: string[];
  sourceReviewStatus?: string;
  policyDecisionRefs?: string[];
};

export type ValidationReport = {
  status: "pass" | "fail";
  checks: {
    id: string;
    status: "pass" | "fail";
    summary: string;
    failureClass?: string;
  }[];
};

export function validateModelOutputAgainstAuthority(output: unknown, snapshot: AuthoritySnapshot): ValidationReport {
  const checks = [validateNoRawToolExecution(output), validateAchSurvivors(output, snapshot), validateAchRanking(output, snapshot)];
  return {
    status: checks.every((check) => check.status === "pass") ? "pass" : "fail",
    checks
  };
}

export function rejectToolExecutionFromRawModelOutput(output: unknown): PolicyDecision {
  const check = validateNoRawToolExecution(output);
  if (check.status === "fail") {
    return {
      decision: "deny",
      risk: "POLICY_CHANGE",
      reason: check.summary
    };
  }
  return {
    decision: "allow",
    risk: "READ",
    reason: "Model output does not attempt raw tool execution."
  };
}

function validateNoRawToolExecution(output: unknown): ValidationReport["checks"][number] {
  const paths = findKeys(output, ["tool_call", "tool_calls", "toolCalls", "execute", "command", "shell"]);
  if (paths.length > 0) {
    return {
      id: "model-raw-tool-execution",
      status: "fail",
      summary: `Model output contains raw tool execution field(s): ${paths.join(", ")}.`,
      failureClass: "raw_model_tool_execution"
    };
  }
  return {
    id: "model-raw-tool-execution",
    status: "pass",
    summary: "Model output does not contain raw tool execution fields."
  };
}

function validateAchSurvivors(output: unknown, snapshot: AuthoritySnapshot): ValidationReport["checks"][number] {
  if (!snapshot.achSurvivors) {
    return {
      id: "model-authority-ach",
      status: "pass",
      summary: "No ACH authority snapshot was provided."
    };
  }

  const proposed = extractStringArray(output, ["survivors", "achSurvivors", "winningHypotheses"]);
  if (!proposed) {
    return {
      id: "model-authority-ach",
      status: "pass",
      summary: "Model output does not attempt to replace ACH survivors."
    };
  }

  const expected = [...snapshot.achSurvivors].sort().join("|");
  const actual = [...proposed].sort().join("|");
  if (expected !== actual) {
    return {
      id: "model-authority-ach",
      status: "fail",
      summary: `Model output attempted to override ACH survivors. expected=${expected} actual=${actual}`,
      failureClass: "model_authority_override"
    };
  }
  return {
    id: "model-authority-ach",
    status: "pass",
    summary: "Model output matches ACH authority snapshot."
  };
}

function validateAchRanking(output: unknown, snapshot: AuthoritySnapshot): ValidationReport["checks"][number] {
  if (!snapshot.achRanking) {
    return {
      id: "model-authority-ach-ranking",
      status: "pass",
      summary: "No ACH ranking authority snapshot was provided."
    };
  }
  const proposed = extractRanking(output);
  if (!proposed) {
    return {
      id: "model-authority-ach-ranking",
      status: "pass",
      summary: "Model output does not attempt to replace ACH ranking."
    };
  }
  const expected = snapshot.achRanking.join("|");
  const actual = proposed.join("|");
  if (expected !== actual) {
    return {
      id: "model-authority-ach-ranking",
      status: "fail",
      summary: `Model output attempted to override ACH ranking. expected=${expected} actual=${actual}`,
      failureClass: "model_authority_override"
    };
  }
  return {
    id: "model-authority-ach-ranking",
    status: "pass",
    summary: "Model output matches ACH ranking authority snapshot."
  };
}

function findKeys(value: unknown, keys: string[], path: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findKeys(item, keys, [...path, String(index)]));
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const nextPath = [...path, key];
    const current = keys.includes(key) ? [nextPath.join(".")] : [];
    return [...current, ...findKeys(child, keys, nextPath)];
  });
}

function extractStringArray(value: unknown, keys: string[]): string[] | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractStringArray(item, keys);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (keys.includes(key) && Array.isArray(child) && child.every((item) => typeof item === "string")) {
      return child;
    }
    const found = extractStringArray(child, keys);
    if (found) return found;
  }
  return undefined;
}

function extractRanking(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractRanking(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value)) {
    if ((key === "ranking" || key === "ranked") && Array.isArray(child)) {
      if (child.every((item) => typeof item === "string")) return child;
      if (child.every((item) => item && typeof item === "object" && "hypothesis" in item)) {
        return child.map((item) => String((item as { hypothesis: unknown }).hypothesis));
      }
    }
    const found = extractRanking(child);
    if (found) return found;
  }
  return undefined;
}
