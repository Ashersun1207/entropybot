import { VitestTestRunner } from "vitest/runners";
import type { RunnerTask, RunnerTestCase } from "vitest";

export default class StrictFullGateRunner extends VitestTestRunner {
  override onBeforeRunTask(test: RunnerTestCase) {
    if (test.retry || test.repeats || this.config.retry || this.config.testNamePattern || this.config.passWithNoTests) {
      throw new Error("Full gate forbids retries, repeats, filters and passWithNoTests");
    }
    return super.onBeforeRunTask(test);
  }

  override onAfterRunTask(task: RunnerTask) {
    if (task.result?.retryCount || task.result?.repeatCount) throw new Error("Full gate detected retry/repeat");
    return super.onAfterRunTask(task);
  }
}
