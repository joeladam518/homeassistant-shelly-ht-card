import type { HomeAssistant } from "homeassistant-ui-shared";
import { act, flush, stubHaElements } from "homeassistant-ui-shared/testing";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { ShellyHtCardElement as ShellyHtCard } from "./card.tsx";

beforeAll(async () => {
  stubHaElements();
  await import("./index.ts");
});

const HOUR = 3600_000;

const entity = (entity_id: string, state: string, attributes: Record<string, unknown> = {}) => ({
  entity_id,
  state,
  attributes,
  context: { id: "", parent_id: null, user_id: null },
  last_changed: "",
  last_updated: new Date(Date.now() - 20 * 60_000).toISOString(),
});

function fakeHass(temp = "21.5"): HomeAssistant {
  const now = Date.now();
  return {
    states: {
      "sensor.ht_temperature": entity("sensor.ht_temperature", temp, {
        device_class: "temperature",
        unit_of_measurement: "°C",
        friendly_name: "H&T Temperature",
      }),
      "sensor.ht_humidity": entity("sensor.ht_humidity", "44.6", { device_class: "humidity" }),
      "sensor.ht_battery": entity("sensor.ht_battery", "64", { device_class: "battery" }),
    },
    entities: {
      "sensor.ht_temperature": { entity_id: "sensor.ht_temperature", device_id: "ht" },
      "sensor.ht_humidity": { entity_id: "sensor.ht_humidity", device_id: "ht" },
      "sensor.ht_battery": { entity_id: "sensor.ht_battery", device_id: "ht" },
    },
    devices: { ht: { id: "ht", area_id: "bedroom" } },
    areas: { bedroom: { area_id: "bedroom", name: "Bedroom" } },
    config: {} as HomeAssistant["config"],
    locale: { language: "en-US" },
    connection: {} as HomeAssistant["connection"],
    callService: vi.fn(() => Promise.resolve()),
    callWS: vi.fn(() =>
      Promise.resolve({
        "sensor.ht_temperature": [
          { start: now - 2 * HOUR, mean: 20.5, min: 19.8, max: 20.9 },
          { start: now - HOUR, mean: 20.9, min: 20.6, max: 21.2 },
        ],
        "sensor.ht_humidity": [
          { start: now - 2 * HOUR, mean: 41 },
          { start: now - HOUR, mean: 47 },
        ],
      }),
    ) as HomeAssistant["callWS"],
  };
}

async function mount(config: Record<string, unknown> = {}, hass = fakeHass()): Promise<ShellyHtCard> {
  const card = document.createElement("shelly-ht-card") as ShellyHtCard;
  await act(() => {
    card.setConfig({ type: "custom:shelly-ht-card", temperature: "sensor.ht_temperature", ...config });
    card.hass = hass;
    document.body.append(card);
  });
  // Wait for the 24-hour history (fetched over the fake websocket) to render.
  await vi.waitFor(() => expect(card.shadowRoot?.querySelector(".v")?.textContent).toMatch(/\d/));
  await flush();
  return card;
}

const text = (card: ShellyHtCard, sel: string) => card.shadowRoot!.querySelector(sel)!.textContent!.trim();

describe("shelly-ht-card", () => {
  it("is listed in the card picker", () => {
    expect(window.customCards?.some((c) => c.type === "shelly-ht-card")).toBe(true);
  });

  it("shows the area name, temperature, humidity, comfort and battery", async () => {
    const card = await mount();
    expect(text(card, ".name")).toBe("Bedroom");
    expect(text(card, ".num")).toBe("21.5");
    expect(text(card, ".unit")).toBe("°C");
    expect(text(card, ".hnum")).toBe("45");
    expect(text(card, ".comfort")).toBe("Comfortable");
    expect(text(card, ".battery span")).toBe("64%");
    expect(card.shadowRoot!.querySelector(".battery")!.classList.contains("mid")).toBe(true);
    expect(card.shadowRoot!.querySelector("ha-icon.battery, .battery ha-icon")).toHaveProperty(
      "icon",
      "mdi:battery-60",
    );
  });

  it("shows the 24-hour low / high and humidity range", async () => {
    const card = await mount();
    const values = [...card.shadowRoot!.querySelectorAll(".v")].map((e) => e.textContent!.trim());
    expect(values.slice(0, 3)).toEqual(["19.8°C", "21.5°C", "41–47%"]);
    expect(values[3]).toBe("20 min ago");
  });

  it("shows a rising trend when it's warmer than an hour ago", async () => {
    const card = await mount();
    const trend = card.shadowRoot!.querySelector(".trend")!;
    expect(trend).toHaveProperty("icon", "mdi:trending-up");
    expect(trend.getAttribute("title")).toBe("Rising");
  });

  it("uses the configured name and opens humidity history", async () => {
    const card = await mount({ name: "Guest room" });
    expect(text(card, ".name")).toBe("Guest room");
    const opened = vi.fn();
    card.addEventListener("hass-more-info", (e) => opened((e as CustomEvent).detail.entityId));
    card.shadowRoot!.querySelector<HTMLElement>(".hum")!.click();
    expect(opened).toHaveBeenCalledWith("sensor.ht_humidity");
  });

  it("dims the card while the sensor is unavailable", async () => {
    const card = document.createElement("shelly-ht-card") as ShellyHtCard;
    await act(() => {
      card.setConfig({ type: "custom:shelly-ht-card", temperature: "sensor.ht_temperature" });
      card.hass = fakeHass("unavailable");
      document.body.append(card);
    });
    await flush();
    expect(card.shadowRoot!.querySelector("ha-card")!.classList.contains("stale")).toBe(true);
    expect(text(card, ".num")).toBe("–");
  });

  it("needs a temperature sensor", () => {
    const card = document.createElement("shelly-ht-card") as ShellyHtCard;
    expect(() => card.setConfig({ type: "custom:shelly-ht-card" } as never)).toThrow(/temperature/);
  });
});
