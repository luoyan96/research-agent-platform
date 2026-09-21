import { describe, expect, it } from "vitest";
import {
  Task,
  Member,
  Deliverable,
  contractVersion,
  routes,
} from "@research-agent-platform/contracts";
import {
  fixtures,
  endpointExamples,
} from "@research-agent-platform/contracts/fixtures";
import {
  contractTasks,
  contractMembers,
  contractSteps,
  contractDelivery,
  fixture,
  fixtureContractVersion,
} from "../src/fixture-adapter";
import { projectTask } from "../src/contract-projection";

describe("F0 consumes B0 contract 0.1.0", () => {
  it("validates every shared semantic and endpoint example", () => {
    expect(contractVersion).toBe("0.1.0");
    for (const example of Object.values(fixtures))
      example.schema.parse(example.value);
    for (const [name, example] of Object.entries(endpointExamples)) {
      const route = routes[name as keyof typeof routes];
      route.request.parse(example.request);
      route.response.parse(example.response);
    }
  });
  it("validates the authored visual tasks and members before rendering", () => {
    expect(fixtureContractVersion).toBe(contractVersion);
    contractTasks.forEach((task) => Task.parse(task));
    contractMembers.forEach((member) => Member.parse(member));
    contractSteps.forEach((task) => Task.parse(task));
    Deliverable.parse(contractDelivery);
    expect(fixture.tasks.find((task) => task.id === "proposal")).toMatchObject({
      column: 1,
      state: "受阻",
    });
    expect(
      contractTasks.find((task) => task.id === "patent")?.schedule.committed,
    ).toBeNull();
    expect(contractMembers[3]?.availability).toBeNull();
  });
  it("does not place cancelled tasks in completed, or change a blocked task to running", () => {
    const cancelled = fixtures.cancelledTask.schema.parse(
      fixtures.cancelledTask.value,
    ).data;
    expect(projectTask(cancelled, fixture.tasks[0]!)).toBeNull();
    const blocked = fixtures.blockedTask.schema.parse(
      fixtures.blockedTask.value,
    ).data;
    expect(projectTask(blocked, fixture.tasks[0]!)).toMatchObject({
      column: 1,
      state: "受阻",
    });
  });
});
