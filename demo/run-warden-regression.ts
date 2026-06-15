import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRegressionResults,
  createBuiltInNormalRegressionCase,
  loadRegressionCases,
  renderRegressionSummary,
  runRegressionSuite
} from "../src/agent/regression.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(here, "../fixtures/regression");
const cases = [createBuiltInNormalRegressionCase(), ...loadRegressionCases(fixtureDir)];
const results = await runRegressionSuite(cases);

console.log(renderRegressionSummary(results));
assertRegressionResults(results);
