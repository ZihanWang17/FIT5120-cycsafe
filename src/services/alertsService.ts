// src/services/alertsService.ts

// ===== 型別（和 AlertTray / Header 對齊）=====
export type AlertLite = {
  clusterId: string;
  incidentType: string;
  status?: "pending" | "active";
  reportCount?: number;
  expiresAt: number;                // epoch seconds
  severity?: "low" | "medium" | "high";
  lat?: number;
  lng?: number;
  photoUrls?: string[];
  ackCount?: number;

  // weather / system / vic incidents 專用欄位
  description?: string;
  ackable?: boolean;                // 天氣/系統/官方事件請設 false
  address?: string;                 // 顯示在托盤右上角
  agoText?: string;
};

export type AlertsPayload = {
  ok: boolean;
  serverNow: number;
  alerts: AlertLite[];
};

// 後端 list-alerts（Clusters）
const LIST_URL =
  import.meta.env.VITE_LIST_ALERTS_URL ||
  "https://7wijeaz2y64ixyvovqkhjoysya0lksii.lambda-url.ap-southeast-2.on.aws/";

// Vic emergency feed（官方 GeoJSON）
const VIC_INCIDENTS_URL = "https://emergency.vic.gov.au/public/events-geojson.json";

// 半徑公尺
const NEARBY_M = 250;

const REFRESH_MS = 60_000;

let timer: number | undefined;
let inflight: AbortController | null = null;

// 綁同一個 handler，方便 removeEventListener
const onMaybeChanged = () => { void fetchOnce(); };
const onWeatherList  = () => { void fetchOnce(); };
const onVisible = () => {
  if (document.visibilityState === "visible") void fetchOnce();
};

export function startAlertsPolling() {
  // ✅ 先把任何舊的 interval / 監聽 / inflight 清乾淨
  stopAlertsPolling();

  // ✅ 建立新的輪詢
  timer = window.setInterval(fetchOnce, REFRESH_MS);

  // ✅ 註冊事件（可能變動時與回到前景時立即更新）
  window.addEventListener("cs:alerts:maybeChanged", onMaybeChanged);
  window.addEventListener("cs:weather:list", onWeatherList);
  window.addEventListener("focus", onVisible);
  document.addEventListener("visibilitychange", onVisible);

  // ✅ 最後再跑一次立即抓取
  void fetchOnce();
}

export function stopAlertsPolling() {
  if (timer) window.clearInterval(timer);
  timer = undefined;

  window.removeEventListener("cs:alerts:maybeChanged", onMaybeChanged);
  window.removeEventListener("cs:weather:list", onWeatherList);
  window.removeEventListener("focus", onVisible);
  document.removeEventListener("visibilitychange", onVisible);

  if (inflight) {
    inflight.abort();
    inflight = null;
  }
}

async function fetchVicIncidents(signal?: AbortSignal): Promise<AlertLite[]> {
  // 沒座標 → 無法判斷 250m，直接回空
  let lat: number | undefined;
  let lon: number | undefined;
  try {
    const cs = localStorage.getItem("cs.coords");
    if (cs) {
      const parsed = JSON.parse(cs);
      if (Number.isFinite(parsed?.lat) && Number.isFinite(parsed?.lon)) {
        lat = parsed.lat; lon = parsed.lon;
      }
    }
  } catch {}

  if (lat == null || lon == null) return [];

  try {
    const res = await fetch(VIC_INCIDENTS_URL, { cache: "no-store", signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const feats: any[] = Array.isArray(json?.features) ? json.features : [];
    const near: AlertLite[] = [];

    for (const f of feats) {
      const p = f?.properties || {};
      const g = f?.geometry || {};
      // geometry may be Point, MultiPoint, etc. try to read a single [lon, lat]
      const coords: number[] =
        Array.isArray(g?.coordinates) && typeof g?.type === "string"
          ? (g.type === "Point" ? g.coordinates
            : Array.isArray(g.coordinates[0]) ? g.coordinates[0] : [])
          : [];

      const lonF = Number(coords?.[0]);
      const latF = Number(coords?.[1]);
      if (!Number.isFinite(latF) || !Number.isFinite(lonF)) continue;

      if (distanceMeters(lat, lon, latF, lonF) > NEARBY_M) continue;

      // 清洗欄位（盡量兼容）
      const name = stringFirst(p.name, p.title, p.eventName);
      const info = stringFirst(p.info, p.description, p.details);
      const loc  = stringFirst(p.location, p.locality, p.area, `${latF.toFixed(5)}, ${lonF.toFixed(5)}`);
      const tsRaw = stringFirst(p.timestamp, p.publishDate, p.updated, p.created) || Date.now();
      const ts = toIso(tsRaw);

      // 沒有基本資訊 → 略過
      if (!name) continue;

      const id = stringFirst(p.id, p.eventId, p.guid) || `${latF.toFixed(5)}_${lonF.toFixed(5)}_${ts}`;
      near.push({
        clusterId: `vic#${String(id)}`,
        incidentType: "vic_incident",
        severity: "medium",
        expiresAt: Math.floor(Date.now() / 1000) + 30 * 60, // 30 分鐘 TTL
        lat: latF,
        lng: lonF,
        ackable: false,
        description: name,
        address: loc,
        agoText: "0 minutes ago",
        // payload for tray is minimal; page will pull full info
      });
    }

    return near;
  } catch (e) {
    console.warn("vic incidents fetch failed", e);
    return [];
  }
}

async function fetchOnce() {
  try {
    // 取消上一個尚未完成的請求
    if (inflight) inflight.abort();
    inflight = new AbortController();

    // 1) 後端 clusters
    const res = await fetch(LIST_URL, { cache: "no-store", signal: inflight.signal });
    const data: AlertsPayload = await res.json().catch(() => ({ ok:false, alerts:[], serverNow:0 } as AlertsPayload));
    const backend = Array.isArray(data?.alerts) ? data.alerts : [];

    // 2) 本地天氣（Home.tsx 會寫入 localStorage 並 dispatch cs:weather:list）
    let weather: AlertLite[] = [];
    try {
      const raw = JSON.parse(localStorage.getItem("cs.weather.alerts") || "[]");
      weather = Array.isArray(raw) ? raw : [];
    } catch {
      weather = [];
    }

    // 3) 官方 Vic 事件（取 250m 內）
    const vic = await fetchVicIncidents(inflight.signal);

    // 4) 合併 + 過濾未過期 + 去重（同 clusterId 保留 expiresAt 較大的）
    const now = Math.floor(Date.now() / 1000);
    const mergedRaw: AlertLite[] = [...backend, ...weather, ...vic].filter(
      a => Number(a?.expiresAt || 0) > now
    );

    const byId = new Map<string, AlertLite>();
    for (const a of mergedRaw) {
      const id = String(a?.clusterId || "");
      if (!id) continue;
      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, a);
      } else {
        const keep = Number(a?.expiresAt || 0) >= Number(prev?.expiresAt || 0) ? a : prev;
        byId.set(id, keep);
      }
    }

    const merged = Array.from(byId.values());

    // 5) 排序（剩餘時間長的在上）
    merged.sort((x, y) => Number(y?.expiresAt || 0) - Number(x?.expiresAt || 0));

    // 6) 寫入 localStorage + 廣播
    localStorage.setItem("cs.alerts.list", JSON.stringify(merged));
    localStorage.setItem("cs.alerts.total", String(merged.length));
    localStorage.setItem("cs.alerts.updatedAt", String(Date.now()));

    window.dispatchEvent(new CustomEvent("cs:alerts", { detail: { total: merged.length } }));
    window.dispatchEvent(new CustomEvent("cs:alerts:list", { detail: { list: merged } }));
  } catch (e) {
    if ((e as any)?.name === "AbortError") return; // 主動取消就忽略
    console.error("load alerts failed", e);
  } finally {
    inflight = null;
  }
}

/* ========== helpers ========== */

function stringFirst(...vals: any[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Number.isFinite(v)) return String(v);
    if (v instanceof Date) return v.toISOString();
  }
  return "";
}

function toIso(v: any): string {
  if (!v) return new Date().toISOString();
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (Number.isFinite(v)) {
    const d = new Date(Number(v));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

// Haversine
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000; // m
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
function toRad(d: number) { return (d * Math.PI) / 180; }
