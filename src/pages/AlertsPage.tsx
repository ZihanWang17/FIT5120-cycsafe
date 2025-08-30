// src/pages/AlertsPage.tsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import "./AlertsPage.css";
import AlertItem from "../components/AlertItem";

import weatherIcon from "../assets/weather.svg";
import trafficIcon from "../assets/traffic.svg";
import infrastructureIcon from "../assets/infrastructure.svg";
import warningIcon from "../assets/warning.svg";
import bellOutlineIcon from "../assets/bell-outline.svg";
import { timeFromNow } from "../lib/time";
import { Dialog, DialogContent, DialogTitle } from "@mui/material";
import { computeRiskLevel } from "../lib/RiskMatrix";

type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type Category = "WEATHER" | "TRAFFIC" | "INFRA" | "SAFETY" | "INCIDENT";

type AlertModel = {
  title: string;
  description: string;
  location: string;
  time?: string;
  timestamp?: number | string;
  priority: Priority;
  category: Category;
  info?: string;
};

type RiskResp = {
  ok: boolean;
  address?: string;
  lat?: number;
  lon?: number;
  weather?: { windSpeed?: number; precipitation?: number; temperature?: number };
  atmosphere?: string;
};

const API =
  import.meta.env.VITE_LAMBDA_URL ??
  "https://dbetjhlyj7smwrgcptcozm6amq0ovept.lambda-url.ap-southeast-2.on.aws/";

const VIC_EVENTS_URL  = "https://emergency.vic.gov.au/public/events-geojson.json";
const VIC_IMPACT_URL  = "https://emergency.vic.gov.au/public/impact-areas-geojson.json";

const FALLBACK = { lat: -37.8136, lon: 144.9631 };
const ADDRESS_KEY = "cs.address";
const COORDS_KEY  = "cs.coords";

// 只顯示 250m 內官方事件
const NEARBY_M = 250;

// 風雨門檻（Open-Meteo 風速 m/s；1 m/s ≈ 3.6 km/h）
const WIND_MED  = 11;
const WIND_HIGH = 17;
const RAIN_MED  = 1.0;
const RAIN_HIGH = 3.0;

/* weather helpers */
function weatherLabelFrom(data?: RiskResp["weather"]) {
  const ws = Number(data?.windSpeed ?? 0);
  const pr = Number(data?.precipitation ?? 0);
  if (pr >= 1) return "Rain";
  if (ws >= 12) return "Windy";
  return "Clear";
}
function weatherEmoji(text: string) {
  const t = text.toLowerCase();
  if (t.includes("rain")) return "🌧️";
  if (t.includes("wind")) return "🌬️";
  if (t.includes("fog") || t.includes("mist")) return "🌫️";
  if (t.includes("cloud")) return "⛅️";
  return "☀️";
}

/* string utils */
const stripHtml = (s?: string) => (s ? s.replace(/<[^>]*>/g, "").trim() : "");
const stringFirst = (...vals: any[]): string => {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Number.isFinite(v)) return String(v);
    if (v instanceof Date) return v.toISOString();
  }
  return "";
};
function toEpoch(v: any): number {
  if (!v) return Date.now();
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  if (Number.isFinite(v)) return Number(v);
  return Date.now();
}

/* geometry helpers */
function toRad(d: number) { return (d * Math.PI) / 180; }
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat/2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function pointInsidePolygon(lat: number, lon: number, polygon: number[][]): boolean {
  // ray casting (planar approx good enough for 250m)
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1], yi = polygon[i][0];
    const xj = polygon[j][1], yj = polygon[j][0];
    const intersect = ((yi > lon) !== (yj > lon)) &&
      (lat < ((xj - xi) * (lon - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function minDistanceToRingM(lat: number, lon: number, ring: number[][]): number {
  // min of vertex distances (good enough at small scale)
  let min = Infinity;
  for (const [lng, latp] of ring) {
    const d = haversineM(lat, lon, latp, lng);
    if (d < min) min = d;
  }
  return min;
}
function pointToPolygonDistanceM(lat: number, lon: number, coords: number[][][]): number {
  // coords: [ [ [lng,lat], ... ] , [hole], ... ]
  const outer = coords[0] || [];
  if (pointInsidePolygon(lat, lon, outer)) return 0;
  return minDistanceToRingM(lat, lon, outer);
}
function pointToMultiPolygonDistanceM(lat: number, lon: number, mp: number[][][][]): number {
  let min = Infinity;
  for (const poly of mp) {
    const d = pointToPolygonDistanceM(lat, lon, poly);
    if (d < min) min = d;
  }
  return min;
}

/* priority mapping */
function mapPriorityFrom(props: Record<string, any>): Priority {
  const wl = String(props.warningLevel || props.warning || "").toLowerCase();
  if (wl.includes("emergency")) return "HIGH";
  if (wl.includes("watch") || wl.includes("act")) return "MEDIUM";
  if (wl.includes("advice") || wl.includes("information")) return "LOW";

  // fallback: category signals
  const c1 = String(props.category1 || props.category || "").toLowerCase();
  if (c1.includes("fire") || c1.includes("flood")) return "HIGH";
  return "MEDIUM";
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertModel[]>([]);
  const [address, setAddress] = useState<string>("");
  const [, setTick] = useState(0);

  // Risk chip
  const [riskLevel, setRiskLevel] = useState<"LOW" | "MED" | "HIGH">("LOW");
  const [weatherText, setWeatherText] = useState<string>("");

  // Modal
  const [openInfo, setOpenInfo] = useState<string | null>(null);

  // Coords
  const coordsRef = useRef<{ lat: number; lon: number }>(FALLBACK);
  const pollRef   = useRef<number | null>(null);

  const sanitizeIncidents = (list: AlertModel[]) =>
    (list || []).filter(Boolean).filter(x => x.title || x.description).filter(x => x.timestamp != null);

  /* ===== VIC: events (points/lines/polygons, we only use Point coordinates here) ===== */
  const fetchVicEvents = useCallback(async (lat: number, lon: number, signal?: AbortSignal) => {
    try {
      const res = await fetch(VIC_EVENTS_URL, { cache: "no-store", signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const feats: any[] = Array.isArray(json?.features) ? json.features : [];
      const items: AlertModel[] = [];

      for (const f of feats) {
        const p = f?.properties || {};
        const g = f?.geometry || {};
        // Normalize to a single lon/lat pair (Point only)
        let lonF: number | undefined, latF: number | undefined;
        if (g?.type === "Point" && Array.isArray(g.coordinates)) {
          lonF = Number(g.coordinates[0]); latF = Number(g.coordinates[1]);
        } else if (g?.type === "LineString" && Array.isArray(g.coordinates?.[0])) {
          lonF = Number(g.coordinates[0][0]); latF = Number(g.coordinates[0][1]);
        } else {
          continue;
        }
        if (!Number.isFinite(latF!) || !Number.isFinite(lonF!)) continue;

        const dist = haversineM(lat, lon, latF!, lonF!);
        if (dist > NEARBY_M) continue;

        const name = stringFirst(p.title, p.eventName, p.name, p.headline, p.category1, p.category2) || "Official Incident";
        const descr = stripHtml(
          stringFirst(p.description, p.info, p.details, p.category2)
        ) || "Official incident reported nearby.";
        const loc  = stringFirst(p.location, p.locality, p.area, `${latF!.toFixed(5)}, ${lonF!.toFixed(5)}`);
        const ts   = toEpoch(stringFirst(p.lastUpdated, p.updated, p.publishDate, p.created));

        items.push({
          title: name,
          description: descr,
          location: loc,
          timestamp: ts,
          priority: mapPriorityFrom(p),
          category: "INCIDENT",
          info: stripHtml(p.description || p.info || "") || undefined,
        });
      }
      return items;
    } catch (e: any) {
      if (e?.name === "AbortError") return [];
      console.warn("vic events load failed:", e);
      return [];
    }
  }, []);

  /* ===== VIC: impact areas (Polygon/MultiPolygon) ===== */
  const fetchVicImpactAreas = useCallback(async (lat: number, lon: number, signal?: AbortSignal) => {
    try {
      const res = await fetch(VIC_IMPACT_URL, { cache: "no-store", signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const feats: any[] = Array.isArray(json?.features) ? json.features : [];
      const items: AlertModel[] = [];

      for (const f of feats) {
        const p = f?.properties || {};
        const g = f?.geometry || {};
        if (!g?.type || !Array.isArray(g.coordinates)) continue;

        let distM = Infinity;
        if (g.type === "Polygon") {
          distM = pointToPolygonDistanceM(lat, lon, g.coordinates as number[][][]);
        } else if (g.type === "MultiPolygon") {
          distM = pointToMultiPolygonDistanceM(lat, lon, g.coordinates as number[][][][]);
        } else {
          continue;
        }
        if (distM > NEARBY_M) continue;

        const title = stringFirst(p.headline, p.title, p.category1, p.warningLevel) || "Official Incident";
        const summary = stripHtml(stringFirst(p.description, p.summary, p.detail)) || "Official incident reported nearby.";
        const loc = stringFirst(p.locality, p.area, p.location, address || "Nearby");
        const ts = toEpoch(stringFirst(p.lastUpdated, p.updated, p.publishDate, p.created));

        items.push({
          title,
          description: summary,
          location: loc,
          timestamp: ts,
          priority: mapPriorityFrom(p),
          category: "INCIDENT",
          info: stripHtml(p.description || "") || undefined,
        });
      }
      return items;
    } catch (e: any) {
      if (e?.name === "AbortError") return [];
      console.warn("vic impact areas load failed:", e);
      return [];
    }
  }, [address]);

  /** 取 alerts + risk chip synchronised with current coords */
  const fetchAlerts = useCallback(async (lat: number, lon: number, signal?: AbortSignal) => {
    const collected: AlertModel[] = [];
    try {
      const url = new URL(API);
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lon));
      url.searchParams.set("ts", String(Date.now()));

      const res = await fetch(url.toString(), { cache: "no-store", signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: RiskResp = await res.json();

      const addr = data.address || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      setAddress(addr);
      try {
        localStorage.setItem(ADDRESS_KEY, addr);
        window.dispatchEvent(new CustomEvent("cs:address", { detail: addr }));
      } catch {}

      // Risk chip (must match Home)
      const wxText = weatherLabelFrom(data.weather);
      setWeatherText(wxText);
      const wxCode: 1|2|7 =
        Number(data.weather?.windSpeed ?? 0) >= 12 ? 7 :
        Number(data.weather?.precipitation ?? 0) >= 1 ? 2 : 1;
      const now = new Date();
      const risk = computeRiskLevel({
        lat, lon,
        hour: now.getHours(),
        month: now.getMonth() + 1,
        dow: now.getDay(),
        weatherCode: wxCode,
      });
      setRiskLevel(risk.riskLevel);

      // Weather card(s)
      const ws   = Number(data.weather?.windSpeed ?? 0);
      const rain = Number(data.weather?.precipitation ?? 0);
      if (ws >= WIND_HIGH || rain >= RAIN_HIGH) {
        collected.push({
          title: "Severe Weather Warning",
          description: `Strong winds (~${Math.round(ws)} m/s) or heavy rain (${rain.toFixed(1)} mm/h). Reduced visibility and hazardous conditions.`,
          location: addr,
          timestamp: Date.now(),
          priority: "HIGH",
          category: "WEATHER",
        });
      } else if (ws >= WIND_MED || rain >= RAIN_MED) {
        collected.push({
          title: "Weather Alert",
          description: `Wind ~ ${Math.round(ws)} m/s • Rain ${rain.toFixed(1)} mm/h • Please ride with caution.`,
          location: addr,
          timestamp: Date.now(),
          priority: "MEDIUM",
          category: "WEATHER",
        });
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      console.error("risk/weather fetch failed:", e);
      setAddress(`${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    }

    // Official incidents from BOTH feeds, within 250 m
    const [events, impacts] = await Promise.all([
      fetchVicEvents(lat, lon, signal),
      fetchVicImpactAreas(lat, lon, signal),
    ]);
    collected.push(...events, ...impacts);

    const cleaned = sanitizeIncidents(collected);
    const withDisplayTime = cleaned.map((a) => {
      const diff = Date.now() - Number(a.timestamp ?? Date.now());
      const show = diff >= 60_000;
      return { ...a, time: show ? timeFromNow(a.timestamp ?? Date.now()) : "" };
    });

    setAlerts(withDisplayTime);

    try {
      const total = withDisplayTime.length;
      localStorage.setItem("cs.alerts.total", String(total));
      window.dispatchEvent(new CustomEvent("cs:alerts", { detail: { total } }));
    } catch {}
  }, [fetchVicEvents, fetchVicImpactAreas]);

  /** 初始化：讀取現有座標（Home 已經會存），沒有就 fallback；立刻抓一次 */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COORDS_KEY);
      if (saved) {
        const { lat, lon } = JSON.parse(saved);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          coordsRef.current = { lat, lon };
        }
      }
    } catch {}
    const ac = new AbortController();
    fetchAlerts(coordsRef.current.lat, coordsRef.current.lon, ac.signal);
    return () => ac.abort();
  }, [fetchAlerts]);

  /** Home → coords bus */
  useEffect(() => {
    const onCoords = (e: Event) => {
      const d = (e as CustomEvent).detail as { lat?: number; lon?: number } | undefined;
      if (d?.lat != null && d?.lon != null) {
        coordsRef.current = { lat: d.lat, lon: d.lon };
        const ac = new AbortController();
        fetchAlerts(d.lat, d.lon, ac.signal);
      }
    };
    window.addEventListener("cs:coords", onCoords);
    return () => window.removeEventListener("cs:coords", onCoords);
  }, [fetchAlerts]);

  /** Visible polling each 60s; refresh on focus/visibility */
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      const ac = new AbortController();
      fetchAlerts(coordsRef.current.lat, coordsRef.current.lon, ac.signal);
    };

    const onVis = () => { if (document.visibilityState === "visible") poll(); };
    const onFocus = () => poll();

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);

    pollRef.current = window.setInterval(poll, 60 * 1000);
    const tickId = window.setInterval(() => setTick(v => v + 1), 60_000);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      if (pollRef.current) window.clearInterval(pollRef.current);
      window.clearInterval(tickId);
    };
  }, [fetchAlerts]);

  // Summary counts
  const { critical, high, medium, low } = useMemo(() => {
    return {
      critical: alerts.filter((a) => a.priority === "CRITICAL").length,
      high:     alerts.filter((a) => a.priority === "HIGH").length,
      medium:   alerts.filter((a) => a.priority === "MEDIUM").length,
      low:      alerts.filter((a) => a.priority === "LOW").length,
    };
  }, [alerts]);

  // Category counts
  const categoryCounts = useMemo(() => {
    return {
      WEATHER: alerts.filter((a) => a.category === "WEATHER").length,
      TRAFFIC: alerts.filter((a) => a.category === "TRAFFIC").length,
      INFRA:   alerts.filter((a) => a.category === "INFRA").length,
      SAFETY:  alerts.filter((a) => a.category === "SAFETY").length,
      INCIDENT:alerts.filter((a) => a.category === "INCIDENT").length,
    };
  }, [alerts]);

  const hasLocation = !!coordsRef.current;

  const weatherChip = weatherText ? (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid rgba(0,0,0,.08)",
        background: "rgba(255,255,255,.6)",
        backdropFilter: "blur(2px)"
      }}
    >
      <span>{weatherEmoji(weatherText)}</span>
      <span style={{ opacity: 0.9 }}>{weatherText}</span>
    </div>
  ) : null;

  return (
    <main className="alerts-page">
      <section className="alerts-summary">
        <div className="summary-left">
          <img src={bellOutlineIcon} alt="Alerts" className="summary-icon" />
          <h2>Active Alerts ({alerts.length})</h2>
        </div>
        <div className="priority-stats">
          <div className="priority-item critical"><span>{critical}</span>Critical Priority</div>
          <div className="priority-item high"><span>{high}</span>High Priority</div>
          <div className="priority-item medium"><span>{medium}</span>Medium Priority</div>
          <div className="priority-item low"><span>{low}</span>Low Priority</div>
        </div>
      </section>

      {/* Current Risk card */}
      <section style={{ marginTop: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 14px",
            borderRadius: 12,
            background: "#f8fafc",
            border: "1px solid #e2e8f0"
          }}
        >
          <div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Current Risk</div>
            {weatherChip}
            <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
              Based on local time & weather
            </div>
          </div>
          <div className={`risk-pill ${riskLevel.toLowerCase()}`}>{riskLevel}</div>
        </div>
      </section>

      {/* Empty */}
      {alerts.length === 0 && (
        <section className="alerts-categories">
          <h3>Alert Categories</h3>
          <div className="category-list">
            <div className="category-item">
              <span><img src={weatherIcon} alt="Weather" />Weather Alerts</span>
              <small>Conditions affecting cycling safety</small>
              <em className="cat-count">{categoryCounts.WEATHER}</em>
            </div>
            <div className="category-item">
              <span><img src={warningIcon} alt="Incidents" />Official Incidents</span>
              <small>Emergency incidents reported near you</small>
              <em className="cat-count">{categoryCounts.INCIDENT}</em>
            </div>
          </div>

          <div style={{ marginTop: "1rem", padding: ".8rem 1rem", borderRadius: 10, background: "#f3f4f6", color: "#374151", fontWeight: 700 }}>
            {hasLocation ? "No active alerts nearby." : "Location unavailable. Enable location services to show nearby incidents."}
          </div>
        </section>
      )}

      {/* List */}
      {alerts.length > 0 && (
        <section className="alerts-list">
          {alerts.map((a, idx) => (
            <div key={idx} onClick={() => a.info && setOpenInfo(a.info)} role="button" style={{ cursor: a.info ? "pointer" : "default" }}>
              <AlertItem
                title={a.title}
                description={a.description}
                location={a.location}
                time={a.time || ""}
                priority={a.priority}
              />
            </div>
          ))}
        </section>
      )}

      {/* Categories footer */}
      <section className="alerts-categories">
        <h3>Alert Categories</h3>
        <div className="category-list">
          <div className="category-item">
            <span><img src={weatherIcon} alt="Weather" />Weather Alerts</span>
            <small>Conditions affecting cycling safety</small>
            <em className="cat-count">{categoryCounts.WEATHER}</em>
          </div>
          <div className="category-item">
            <span><img src={trafficIcon} alt="Traffic" />Traffic Incidents</span>
            <small>Accidents and road closures</small>
            <em className="cat-count">{categoryCounts.TRAFFIC}</em>
          </div>
          <div className="category-item">
            <span><img src={infrastructureIcon} alt="Infrastructure" />Infrastructure</span>
            <small>Road works and maintenance</small>
            <em className="cat-count">{categoryCounts.INFRA}</em>
          </div>
          <div className="category-item">
            <span><img src={warningIcon} alt="Warning" />Safety Warnings</span>
            <small>General safety information</small>
            <em className="cat-count">{categoryCounts.SAFETY}</em>
          </div>
        </div>
      </section>

      {/* Incident detail modal */}
      <Dialog open={!!openInfo} onClose={() => setOpenInfo(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Incident Details</DialogTitle>
        <DialogContent dividers>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{openInfo}</div>
        </DialogContent>
      </Dialog>

      <style>{`
        .risk-pill{font-weight:800;padding:.4rem .8rem;border-radius:999px}
        .risk-pill.low{background:#dbeafe;color:#1d4ed8}
        .risk-pill.med{background:#fef9c3;color:#ca8a04}
        .risk-pill.high{background:#fee2e2;color:#b91c1c}
      `}</style>
    </main>
  );
}