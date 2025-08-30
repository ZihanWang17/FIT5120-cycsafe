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

  // weather / system 專用欄位
  description?: string;
  ackable?: boolean;                // 天氣請設 false
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
  // ✅ 先把任何舊的 interval / 監聽 / inflight 清乾淨，避免 abort 目前這次的抓取
  stopAlertsPolling();

  // ✅ 建立新的輪詢
  timer = window.setInterval(fetchOnce, REFRESH_MS);

  // ✅ 註冊事件（可能變動時與回到前景時立即更新）
  window.addEventListener("cs:alerts:maybeChanged", onMaybeChanged);
  window.addEventListener("cs:weather:list", onWeatherList);
  window.addEventListener("focus", onVisible);
  document.addEventListener("visibilitychange", onVisible);

  // ✅ 最後再跑一次立即抓取（不會被 stopAlertsPolling() 立刻 abort）
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

async function fetchOnce() {
  try {
    // 取消上一個尚未完成的請求
    if (inflight) inflight.abort();
    inflight = new AbortController();

    // 1) 後端 clusters
    const res = await fetch(LIST_URL, { cache: "no-store", signal: inflight.signal });
    const data: AlertsPayload = await res.json();
    const backend = Array.isArray(data?.alerts) ? data.alerts : [];

    // 2) 本地天氣（Home.tsx 會寫入 localStorage 並 dispatch cs:weather:list）
    let weather: AlertLite[] = [];
    try {
      const raw = JSON.parse(localStorage.getItem("cs.weather.alerts") || "[]");
      weather = Array.isArray(raw) ? raw : [];
    } catch {
      weather = [];
    }

    // 3) 合併 + 過濾未過期 + 去重（同 clusterId 保留 expiresAt 較大的）
    const now = Math.floor(Date.now() / 1000);
    const mergedRaw: AlertLite[] = [...backend, ...weather].filter(
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

    // 4) 排序（剩餘時間長的在上；也可換 lastReportAt）
    merged.sort((x, y) => Number(y?.expiresAt || 0) - Number(x?.expiresAt || 0));

    // 5) 寫入 localStorage + 廣播
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