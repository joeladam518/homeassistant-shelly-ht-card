import { defineOnce, logVersion, registerCard } from "@joeladam518/homeassistant-ui-shared";

import { ShellyHtCardElement } from "./card.tsx";

defineOnce("shelly-ht-card", ShellyHtCardElement);

registerCard({
  type: "shelly-ht-card",
  name: "Shelly H&T Sensor",
  description:
    "Temperature and humidity from a Shelly H&T: trend, comfort label, 24-hour graph, low/high and battery.",
  preview: true,
});

logVersion("SHELLY-HT-CARD", __VERSION__, "#4aa3ff");
