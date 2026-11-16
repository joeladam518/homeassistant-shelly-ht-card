import { entityAreaName, numericState, siblingSensors } from "@joeladam518/shared-cards/devices.ts";
import { batteryIcon, relTime } from "@joeladam518/shared-cards/format.ts";
import { fireMoreInfo } from "@joeladam518/shared-cards/more-info.ts";
import { areaPath, linePath, type Point, timeScale } from "@joeladam518/shared-cards/sparkline.ts";
import { fetchStats, rowTime, type StatRow } from "@joeladam518/shared-cards/statistics.ts";
import type {
  HomeAssistant,
  LovelaceCardConfig,
  LovelaceGridOptions,
} from "@joeladam518/shared-cards/types.ts";
import { html, LitElement, nothing, unsafeCSS } from "lit";
import { styleMap } from "lit/directives/style-map.js";

import { comfort, isCelsius, toFahrenheit } from "./comfort.ts";

import cardCss from "./card.css?inline";
import baseCss from "@joeladam518/shared-cards/base.css?inline";

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

/**
 * A Shelly H&T (humidity & temperature WiFi sensor) at a glance: big temperature with a trend arrow,
 * humidity, a comfort label, a 24-hour graph of both, the 24-hour low/high, battery and last report.
 */
export class ShellyHtCard extends LitElement {
  static override properties = {
    _config: { state: true },
    _series: { state: true },
  };

  static override styles = [unsafeCSS(baseCss), unsafeCSS(cardCss)];

  declare _config?: ShellyHtCardConfig;
  declare _series: { t: Reading[]; h: Reading[] };

  private _hass?: HomeAssistant;
  private _hum: string | null = null;
  private _bat: string | null = null;
  private _resolved = false;
  private _fetching = false;
  private _timer?: ReturnType<typeof setInterval>;
  private _tick?: ReturnType<typeof setInterval>;

  constructor() {
    super();
    this._series = { t: [], h: [] };
  }

  static getStubConfig(hass: HomeAssistant): Partial<ShellyHtCardConfig> {
    const t = Object.keys(hass?.states || {}).find(
      (id) => id.startsWith("sensor.") && hass.states[id]?.attributes.device_class === "temperature",
    );
    return { temperature: t || "sensor.example_temperature" };
  }

  setConfig(config: ShellyHtCardConfig): void {
    if (!config?.temperature) throw new Error("Set 'temperature' to a temperature sensor");
    this._config = { ...config };
    this._resolved = false;
    if (this._hass) {
      this._resolve();
      void this._fetch();
    }
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  set hass(hass: HomeAssistant) {
    const prev = this._hass;
    this._hass = hass;
    if (!this._config) return;
    this._resolve();
    const temp = this._config.temperature;
    const ids = [temp, this._hum, this._bat];
    if (!prev || ids.some((id) => id && prev.states[id] !== hass.states[id])) this.requestUpdate();
    if (!prev || prev.states[temp] !== hass.states[temp]) void this._fetch();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._timer = setInterval(() => void this._fetch(), FETCH_MS);
    // keeps "Updated 5 min ago" current
    this._tick = setInterval(() => this.requestUpdate(), 60 * 1000);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this._timer);
    clearInterval(this._tick);
  }

  getCardSize(): number {
    return 4;
  }

  getGridOptions(): LovelaceGridOptions {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }

  /* ------------------------------------------------------------ data */

  /** Finds the humidity and battery sensors on the same device, unless the config names them. */
  private _resolve(): void {
    const h = this._hass;
    const c = this._config;
    if (this._resolved || !h || !c) return;
    const sensors = siblingSensors(h, c.temperature);
    const deviceClass = (id: string) => h.states[id]?.attributes?.device_class;
    this._hum = c.humidity || sensors.find((id) => deviceClass(id) === "humidity") || null;
    this._bat = c.battery || sensors.find((id) => deviceClass(id) === "battery") || null;
    this._resolved = true;
  }

  private async _fetch(): Promise<void> {
    const h = this._hass;
    const c = this._config;
    if (!h || !c || this._fetching) return;
    this._fetching = true;
    try {
      const ids = [c.temperature, this._hum].filter((id): id is string => !!id);
      const r = await fetchStats(h, ids, ["mean", "min", "max"]);
      this._series = { t: toReadings(r?.[c.temperature]), h: toReadings(this._hum ? r?.[this._hum] : []) };
    } catch {
      // No history available: the card still shows live values.
    }
    this._fetching = false;
  }

  /* ---------------------------------------------------------- render */

  private _trend(t: number | null, unit: string): { icon: string; title: string } | null {
    const pts = this._series.t;
    if (t == null || !pts.length) return null;
    const target = Date.now() - 3600 * 1000;
    const old = pts.reduce((best, p) => (Math.abs(p.t - target) < Math.abs(best.t - target) ? p : best));
    const d = t - old.v;
    const step = isCelsius(unit) ? 0.2 : 0.4;
    if (d > step) return { icon: "mdi:trending-up", title: "Rising" };
    if (d < -step) return { icon: "mdi:trending-down", title: "Falling" };
    return { icon: "mdi:trending-neutral", title: "Steady" };
  }

  private _graph(tNow: number | null, hNow: number | null): { tLine: string; tArea: string; hLine: string } {
    const now = Date.now();
    const x = timeScale(now - DAY_MS, now, GRAPH_W);
    const tp: Point[] = [...this._series.t, ...(tNow != null ? [{ t: now, v: tNow }] : [])];
    const hp: Point[] = [...this._series.h, ...(hNow != null ? [{ t: now, v: hNow }] : [])];
    const tLine = tp.length >= 2 ? scaledPath(tp, x, 0.5) : "";
    return {
      tLine,
      tArea: areaPath(tLine, tp, x, GRAPH_H),
      hLine: hp.length >= 2 ? scaledPath(hp, x, 2) : "",
    };
  }

  override render(): unknown {
    const h = this._hass;
    const c = this._config;
    if (!h || !c) return nothing;
    const ts = h.states[c.temperature];
    const t = numericState(h, c.temperature);
    const hu = numericState(h, this._hum);
    const b = numericState(h, this._bat);
    const unit = (ts?.attributes?.unit_of_measurement as string | undefined) || "°";
    const stale = !ts || ["unavailable", "unknown"].includes(ts.state);

    const name = c.name || entityAreaName(h, c.temperature) || ts?.attributes?.friendly_name || c.temperature;
    const cf = comfort(t == null ? null : toFahrenheit(t, unit), hu);
    const trend = this._trend(t, unit);

    // 24-hour low / high from history plus the live value
    const temps = [...this._series.t.flatMap((p) => [p.lo, p.hi]), ...(t != null ? [t] : [])];
    const hums = [...this._series.h.map((p) => p.v), ...(hu != null ? [hu] : [])];
    const graph = this._graph(t, hu);
    const battery = b == null ? "" : b < 30 ? "low" : b < 70 ? "mid" : "good";

    return html`
      <ha-card class=${stale ? "stale" : ""} style=${styleMap({ "--temp-color": cf.color })}>
        <div class="top">
          <div class="title">
            <div class="name">${name}</div>
            <div class="comfort">${cf.label}</div>
          </div>
          <button
            class="battery ${battery}"
            title="Battery"
            ?hidden=${b == null}
            @click=${() => fireMoreInfo(this, this._bat)}
          >
            <ha-icon .icon=${batteryIcon(b, { alertAt: 5 })}></ha-icon
            ><span>${b == null ? "" : `${Math.round(b)}%`}</span>
          </button>
        </div>

        <div class="readings">
          <button class="temp" title="Temperature history" @click=${() => fireMoreInfo(this, c.temperature)}>
            <span class="num">${t == null ? "–" : t.toFixed(1)}</span><span class="unit">${unit}</span>
            <ha-icon
              class="trend"
              ?hidden=${!trend}
              .icon=${trend?.icon ?? ""}
              title=${trend?.title ?? ""}
            ></ha-icon>
          </button>
          <button
            class="hum"
            title="Humidity history"
            ?hidden=${!this._hum}
            @click=${() => fireMoreInfo(this, this._hum)}
          >
            <ha-icon icon="mdi:water-percent"></ha-icon
            ><span class="hnum">${hu == null ? "–" : Math.round(hu)}</span><span class="hunit">%</span>
          </button>
        </div>

        <svg
          class="graph"
          viewBox="0 0 300 60"
          preserveAspectRatio="none"
          aria-hidden="true"
          @click=${() => fireMoreInfo(this, c.temperature)}
        >
          <defs>
            <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="var(--temp-color)" stop-opacity=".35" />
              <stop offset="1" stop-color="var(--temp-color)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path fill="url(#tg)" d=${graph.tArea}></path>
          <path
            fill="none"
            stroke="var(--temp-color)"
            stroke-width="2"
            vector-effect="non-scaling-stroke"
            stroke-linejoin="round"
            d=${graph.tLine}
          ></path>
          <path
            fill="none"
            stroke="var(--hum-color)"
            stroke-width="1.5"
            stroke-dasharray="4 3"
            vector-effect="non-scaling-stroke"
            opacity=".85"
            d=${graph.hLine}
          ></path>
        </svg>

        <div class="foot">
          <div>
            <span class="lbl">24 h low</span
            ><span class="v">${temps.length ? `${Math.min(...temps).toFixed(1)}${unit}` : "–"}</span>
          </div>
          <div>
            <span class="lbl">24 h high</span
            ><span class="v">${temps.length ? `${Math.max(...temps).toFixed(1)}${unit}` : "–"}</span>
          </div>
          <div ?hidden=${!this._hum}>
            <span class="lbl">Humidity</span
            ><span class="v"
              >${hums.length ? `${Math.round(Math.min(...hums))}–${Math.round(Math.max(...hums))}%` : "–"}</span
            >
          </div>
          <div>
            <span class="lbl">Updated</span
            ><span class="v">${ts ? relTime(ts.last_reported || ts.last_updated, "spaced") : "–"}</span>
          </div>
        </div>
      </ha-card>
    `;
  }
}
