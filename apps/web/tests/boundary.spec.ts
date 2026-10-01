import { describe, expect, it } from "vitest";
import { escapeHtml, unavailableAdapter } from "../src/view-model";
import { createFixtureAdapter } from "../src/fixture-adapter";

describe("F0 presentation boundaries", () => {
  it("service mode rejects without returning sample data", async () => {
    await expect(
      unavailableAdapter.read(new AbortController().signal),
    ).rejects.toThrow("尚未接通");
  });
  it("escapes untrusted titles before HTML rendering", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">&')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;",
    );
  });
  it("empty scenario has no stale task or people records", async () => {
    expect(
      await createFixtureAdapter("empty").read(new AbortController().signal),
    ).toEqual({ tasks: [], members: [], steps: [] });
  });
  it("failed scenario rejects rather than falling back", async () => {
    await expect(
      createFixtureAdapter("error").read(new AbortController().signal),
    ).rejects.toThrow("失败");
  });
  it("route cancellation aborts pending fixture reads", async () => {
    const abort = new AbortController();
    const read = createFixtureAdapter("loading").read(abort.signal);
    abort.abort();
    await expect(read).rejects.toThrow("Aborted");
  });
});
