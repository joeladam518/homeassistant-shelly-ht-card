export interface Comfort {
  /** e.g. "Comfortable", "Cool · Dry", or "–" with no reading. */
  label: string;
  /** Accent colour for the card. */
  color: string;
}

/** Temperature in °F, whatever unit the sensor reports. */
export const toFahrenheit = (value: number, unit: string | undefined): number =>
  String(unit).includes("C") ? value * 1.8 + 32 : value;

/** Is the sensor reporting Celsius? */
export const isCelsius = (unit: string | undefined): boolean => String(unit).includes("C");

/** A comfort label and colour from temperature (°F) and humidity (%). */
export function comfort(tempF: number | null, humidity: number | null): Comfort {
  let temp: string | null = null;
  let color: string | undefined;
  if (tempF == null) {
    temp = null;
  } else if (tempF < 60) {
    [temp, color] = ["Cold", "#4aa3ff"];
  } else if (tempF < 66) {
    [temp, color] = ["Cool", "#6fc3ff"];
  } else if (tempF < 77) {
    [temp, color] = ["Comfortable", "#4caf50"];
  } else if (tempF < 82) {
    [temp, color] = ["Warm", "#ffa726"];
  } else {
    [temp, color] = ["Hot", "#ef5350"];
  }

  const hum = humidity == null ? null : humidity < 30 ? "Dry" : humidity > 60 ? "Humid" : null;
  return {
    label: [temp, hum].filter(Boolean).join(" · ") || "–",
    color: color || "var(--secondary-text-color)",
  };
}
