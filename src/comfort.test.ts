import { describe, expect, it } from "vitest";

import { comfort, toFahrenheit } from "./comfort.ts";

describe("comfort", () => {
  it.each([
    [55, 45, "Cold"],
    [63, 45, "Cool"],
    [70, 45, "Comfortable"],
    [80, 45, "Warm"],
    [90, 45, "Hot"],
    [70, 25, "Comfortable · Dry"],
    [70, 65, "Comfortable · Humid"],
    [null, null, "–"],
  ])("%s °F, %s %% → %s", (t, h, label) => {
    expect(comfort(t, h).label).toBe(label);
  });

  it("converts Celsius, leaves Fahrenheit alone", () => {
    expect(toFahrenheit(20, "°C")).toBe(68);
    expect(toFahrenheit(68, "°F")).toBe(68);
  });
});
