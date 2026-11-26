import {
  areaPath,
  baseCss,
  batteryIcon,
  type CardProps,
  createCardElement,
  entityAreaName,
  fetchStats,
  fireMoreInfo,
  type HomeAssistant,
  linePath,
  type LovelaceCardConfig,
  numericState,
  type Point,
  relTime,
  rowTime,
  siblingSensors,
  type StatRow,
  timeScale,
  useInterval,
  useNow,
} from "@joeladam518/homeassistant-ui-shared";
import type { FunctionComponent as FC } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { comfort, isCelsius, toFahrenheit } from "./comfort.ts";

import cardCss from "./card.css?inline";

export interface ShellyHtCardConfig extends LovelaceCardConfig {
  name?: string;
  /** Temperature sensor (required). */
  temperature: string;
  /** Humidity sensor; found on the same device if left out. */
  humidity?: string;
  /** Battery sensor; found on the same device if left out. */
  battery?: string;
}

interface Reading extends Point {
  lo: number;
  hi: number;
}

interface Series {
  t: Reading[];
  h: Reading[];
}

interface Sensors {
  hum: string | null;
  bat: string | null;
}

const DAY_MS = 24 * 3600 * 1000;
const FETCH_MS = 10 * 60 * 1000;
const GRAPH_W = 300;
const GRAPH_H = 60;

const toReadings = (rows: StatRow[] | undefined): Reading[] =>
  (rows || [])
    .filter((r) => r.mean != null)
    .map((r) => ({ t: rowTime(r), v: r.mean!, lo: r.min ?? r.mean!, hi: r.max ?? r.mean! }));

/** Path through points, scaled so [lo, hi] fills the graph between `top` and `bottom`. */
function scaledPath(points: Point[], x: (t: number) => number, minPad: number): string {
  const values = points.map((p) => p.v);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = Math.max(minPad, (hi - lo) * 0.15);
  lo -= pad;
  hi += pad;
  const [top, bottom] = [4, 56];
  const span = Math.max(hi - lo, 0.001);
  return linePath(points, x, (v) => bottom - ((v - lo) / span) * (bottom - top));
}

/** Looked up once per config: scanning every entity on each `hass` update would be wasteful. */
const sensorCache = new WeakMap<ShellyHtCardConfig, Sensors>();

/** The humidity and battery sensors: from the config, or found on the same device. */
function sensorsFor(c: ShellyHtCardConfig, hass: HomeAssistant): Sensors {
  let found = sensorCache.get(c);
  if (!found) {
    const sensors = siblingSensors(hass, c.temperature);
    const deviceClass = (id: string) => hass.states[id]?.attributes?.device_class;
    found = {
      hum: c.humidity || sensors.find((id) => deviceClass(id) === "humidity") || null,
      bat: c.battery || sensors.find((id) => deviceClass(id) === "battery") || null,
    };
    sensorCache.set(c, found);
  }
  return found;
}

function trendOf(series: Series, t: number | null, unit: string): { icon: string; title: string } | null {
  const pts = series.t;
  if (t == null || !pts.length) {
    return null;
  }
  const target = Date.now() - 3600 * 1000;
  const old = pts.reduce((best, p) => (Math.abs(p.t - target) < Math.abs(best.t - target) ? p : best));
  const d = t - old.v;
  const step = isCelsius(unit) ? 0.2 : 0.4;
  if (d > step) {
    return { icon: "mdi:trending-up", title: "Rising" };
  }
  if (d < -step) {
    return { icon: "mdi:trending-down", title: "Falling" };
  }
  return { icon: "mdi:trending-neutral", title: "Steady" };
}

function graphOf(
  series: Series,
  tNow: number | null,
  hNow: number | null,
): { tLine: string; tArea: string; hLine: string } {
  const now = Date.now();
  const x = timeScale(now - DAY_MS, now, GRAPH_W);
  const tp: Point[] = [...series.t, ...(tNow != null ? [{ t: now, v: tNow }] : [])];
  const hp: Point[] = [...series.h, ...(hNow != null ? [{ t: now, v: hNow }] : [])];
  const tLine = tp.length >= 2 ? scaledPath(tp, x, 0.5) : "";
  return {
    tLine,
    tArea: areaPath(tLine, tp, x, GRAPH_H),
    hLine: hp.length >= 2 ? scaledPath(hp, x, 2) : "",
  };
}

/**
 * A Shelly H&T (humidity & temperature WiFi sensor) at a glance: big temperature with a trend arrow,
 * humidity, a comfort label, a 24-hour graph of both, the 24-hour low/high, battery and last report.
 */
export const ShellyHtCard: FC<CardProps<ShellyHtCardConfig>> = ({ config: c, hass, host }) => {
  const [series, setSeries] = useState<Series>({ t: [], h: [] });
  const { hum, bat } = sensorsFor(c, hass);
  const ts = hass.states[c.temperature];

  // The fetch always uses the latest hass.
  const hassRef = useRef(hass);
  hassRef.current = hass;
  const fetching = useRef(false);

  const fetchHistory = async (): Promise<void> => {
    if (fetching.current) {
      return;
    }
    fetching.current = true;
    try {
      const ids = [c.temperature, hum].filter((id): id is string => !!id);
      const r = await fetchStats(hassRef.current, ids, ["mean", "min", "max"]);
      setSeries({ t: toReadings(r?.[c.temperature]), h: toReadings(hum ? r?.[hum] : []) });
    } catch {
      // No history available: the card still shows live values.
    }
    fetching.current = false;
  };

  // Refetch when the temperature reports, and every 10 minutes.
  useEffect(() => {
    void fetchHistory();
  }, [ts, c.temperature, hum]);
  useInterval(() => void fetchHistory(), FETCH_MS);

  // keeps "Updated 5 min ago" current
  useNow(60 * 1000);

  const t = numericState(hass, c.temperature);
  const hu = numericState(hass, hum);
  const b = numericState(hass, bat);
  const unit = (ts?.attributes?.unit_of_measurement as string | undefined) || "°";
  const stale = !ts || ["unavailable", "unknown"].includes(ts.state);

  const name =
    c.name ||
    entityAreaName(hass, c.temperature) ||
    (ts?.attributes?.friendly_name as string | undefined) ||
    c.temperature;
  const cf = comfort(t == null ? null : toFahrenheit(t, unit), hu);
  const trend = trendOf(series, t, unit);

  // 24-hour low / high from history plus the live value
  const temps = [...series.t.flatMap((p) => [p.lo, p.hi]), ...(t != null ? [t] : [])];
  const hums = [...series.h.map((p) => p.v), ...(hu != null ? [hu] : [])];
  const graph = graphOf(series, t, hu);
  const battery = b == null ? "" : b < 30 ? "low" : b < 70 ? "mid" : "good";

  return (
    <ha-card class={stale ? "stale" : ""} style={{ "--temp-color": cf.color }}>
      <div class="top">
        <div class="title">
          <div class="name">{name}</div>
          <div class="comfort">{cf.label}</div>
        </div>
        <button
          class={`battery ${battery}`}
          title="Battery"
          hidden={b == null}
          onClick={() => fireMoreInfo(host, bat)}
        >
          <ha-icon icon={batteryIcon(b, { alertAt: 5 })} />
          <span>{b == null ? "" : `${Math.round(b)}%`}</span>
        </button>
      </div>

      <div class="readings">
        <button class="temp" title="Temperature history" onClick={() => fireMoreInfo(host, c.temperature)}>
          <span class="num">{t == null ? "–" : t.toFixed(1)}</span>
          <span class="unit">{unit}</span>
          <ha-icon class="trend" hidden={!trend} icon={trend?.icon ?? ""} title={trend?.title ?? ""} />
        </button>
        <button class="hum" title="Humidity history" hidden={!hum} onClick={() => fireMoreInfo(host, hum)}>
          <ha-icon icon="mdi:water-percent" />
          <span class="hnum">{hu == null ? "–" : Math.round(hu)}</span>
          <span class="hunit">%</span>
        </button>
      </div>

      <svg
        class="graph"
        viewBox="0 0 300 60"
        preserveAspectRatio="none"
        aria-hidden="true"
        onClick={() => fireMoreInfo(host, c.temperature)}
      >
        <defs>
          <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--temp-color)" stop-opacity=".35" />
            <stop offset="1" stop-color="var(--temp-color)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path fill="url(#tg)" d={graph.tArea} />
        <path
          fill="none"
          stroke="var(--temp-color)"
          stroke-width="2"
          vector-effect="non-scaling-stroke"
          stroke-linejoin="round"
          d={graph.tLine}
        />
        <path
          fill="none"
          stroke="var(--hum-color)"
          stroke-width="1.5"
          stroke-dasharray="4 3"
          vector-effect="non-scaling-stroke"
          opacity=".85"
          d={graph.hLine}
        />
      </svg>

      <div class="foot">
        <div>
          <span class="lbl">24 h low</span>
          <span class="v">{temps.length ? `${Math.min(...temps).toFixed(1)}${unit}` : "–"}</span>
        </div>
        <div>
          <span class="lbl">24 h high</span>
          <span class="v">{temps.length ? `${Math.max(...temps).toFixed(1)}${unit}` : "–"}</span>
        </div>
        <div hidden={!hum}>
          <span class="lbl">Humidity</span>
          <span class="v">
            {hums.length ? `${Math.round(Math.min(...hums))}–${Math.round(Math.max(...hums))}%` : "–"}
          </span>
        </div>
        <div>
          <span class="lbl">Updated</span>
          <span class="v">{ts ? relTime(ts.last_reported || ts.last_updated, "spaced") : "–"}</span>
        </div>
      </div>
    </ha-card>
  );
};

export const ShellyHtCardElement = createCardElement(ShellyHtCard, {
  styles: [baseCss, cardCss],
  config: (config: ShellyHtCardConfig): ShellyHtCardConfig => {
    if (!config?.temperature) {
      throw new Error("Set 'temperature' to a temperature sensor");
    }
    return config;
  },
  watch: (c, hass) => {
    const { hum, bat } = sensorsFor(c, hass);
    return [c.temperature, hum, bat];
  },
  cardSize: 4,
  gridOptions: { columns: 12, rows: "auto", min_columns: 6 },
  stubConfig: (hass) => {
    const t = Object.keys(hass?.states || {}).find(
      (id) => id.startsWith("sensor.") && hass.states[id]?.attributes.device_class === "temperature",
    );
    return { temperature: t || "sensor.example_temperature" };
  },
});

export type ShellyHtCardElement = InstanceType<typeof ShellyHtCardElement>;
