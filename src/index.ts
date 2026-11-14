import { ShellyHtCard } from "./card.ts";
import { defineOnce, logVersion, registerCard } from "./lib/register.ts";

defineOnce("shelly-ht-card", ShellyHtCard);

registerCard({
  type: "shelly-ht-card",
  name: "Shelly H&T Sensor",
  description:
    "Temperature and humidity from a Shelly H&T: trend, comfort label, 24-hour graph, low/high and battery.",
  preview: true,
});

logVersion("SHELLY-HT-CARD", __VERSION__, "#4aa3ff");
