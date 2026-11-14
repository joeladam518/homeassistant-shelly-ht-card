import { describe, expect, it } from "vitest";

import hacs from "../hacs.json";

// Runs against the built file (npm run build first), the same file Home Assistant loads.
describe("dist bundle", () => {
  it("is the file the Marketplace installs", () => {
    expect(hacs.filename).toBe("shelly-ht-card.js");
  });

  it("defines the card", async () => {
    // @ts-expect-error -- the built file has no type declarations
    await import("../dist/shelly-ht-card.js");
    expect(customElements.get("shelly-ht-card")).toBeDefined();
    expect(window.customCards?.map((c) => c.type)).toContain("shelly-ht-card");
  });
});
