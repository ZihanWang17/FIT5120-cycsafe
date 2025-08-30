// src/pages/Home.tsx
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import RiskHeaderCard from "../components/RiskHeaderCard";
import RiskBodyCard from "../components/RiskBodyCard";
import "../components/AlertCardWrapper.css";
import FlatCard from "../components/FlatCard";
import GeoPrompt, { type Coords } from "../components/GeoPrompt";
import ReportFab from "../components/ReportFab";

import alertIcon from "../assets/alert.svg";
import routeIcon from "../assets/route.svg";
import insightIcon from "../assets/insight.svg";

type RiskText = "Low Risk" | "Medium Risk" | "High Risk";
type RiskResponse = {
  ok: boolean;
  risk: number;
  riskText: RiskText;
  address?: string;
  lat?: number;
  lon?: number;
  weather?: { windSpeed?: number; precipitation?: number; temperature?: number };
  atmosphere?: string;
};

const API =
  import.meta.env.VITE_LAMBDA_URL ??
  "https://dbetjhlyj7smwrgcptcozm6amq0ovept.lambda-url.ap-southeast-2.on.aws/";

// ===== 可調整參數 =====
const PROMPT_INTERVAL_MS = 10 * 60 * 1000; // 10 分鐘
const ADDRESS_KEY = "cs.address";
const COORDS_KEY = "cs.coords";
const PROMPTED_ONCE_KEY = "cs.loc.promptedOnce";
const LAST_PROMPT_TS_KEY = "cs.loc.lastPromptTs";

const FALLBACK = { lat: -37.8136, lon: 144.9631 }; // Melbourne CBD

// === 小工具：天氣告警寫入/移除（會被 alertsService 合併進托盤）===
type WeatherAlert = {
  clusterId: string;               // e.g. weather#-37.814_144.963
  incidentType: "severe_weather";
  description: string;             // 右側主體文字（不含地址）
  severity: "low" | "medium" | "high";
  expiresAt: number;               // epoch seconds
  ackable: false;                  // 不允許打勾
  photoUrls?: string[];            // 明確給空陣列，避免載圖
  // ⭐ 給 AlertTray 的右上角顯示
  address?: string;
  agoText?: string;
};

function roundCell(lat: number, lon: number, p = 3) {
  const f = 10 ** p;
  const latc = Math.floor(lat * f) / f;
  const lonc = Math.floor(lon * f) / f;
  return `${latc.toFixed(p)}_${lonc.toFixed(p)}`;
}

function upsertWeatherAlert(a: WeatherAlert) {
  let list: WeatherAlert[] = [];
  try { list = JSON.parse(localStorage.getItem("cs.weather.alerts") || "[]") || []; } catch {}
  const idx = list.findIndex((x) => x.clusterId === a.clusterId);
  if (idx === -1) list.push(a); else list[idx] = a;
  localStorage.setItem("cs.weather.alerts", JSON.stringify(list));
  // 提醒 alertsService 立刻重抓並合併
  window.dispatchEvent(new CustomEvent("cs:weather:list"));
}

function removeWeatherAlert(clusterId: string) {
  let list: WeatherAlert[] = [];
  try { list = JSON.parse(localStorage.getItem("cs.weather.alerts") || "[]") || []; } catch {}
  const next = list.filter((x) => x.clusterId !== clusterId);
  localStorage.setItem("cs.weather.alerts", JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("cs:weather:list"));
}

export default function Home() {
  // ===== 顯示用狀態 =====
  const [riskLevel, setRiskLevel] = useState<number>(0);
  const [riskText, setRiskText] = useState<RiskText>("Low Risk");
  const [address, setAddress] = useState<string>("");
  const [alertCount, setAlertCount] = useState<number>(0);

  // 對話框開關
  const [geoOpen, setGeoOpen] = useState<boolean>(false);

  // ===== 小工具 =====
  const markPromptedNow = () => {
    sessionStorage.setItem(PROMPTED_ONCE_KEY, "1");
    sessionStorage.setItem(LAST_PROMPT_TS_KEY, String(Date.now()));
  };
  const isDue = () => {
    const last = Number(sessionStorage.getItem(LAST_PROMPT_TS_KEY) || 0);
    return Date.now() - last >= PROMPT_INTERVAL_MS;
  };

  // 寫入 localStorage 並廣播
  const broadcastAddressAndCoords = useCallback((addr: string, lat: number, lon: number) => {
    try {
      localStorage.setItem(ADDRESS_KEY, addr);
      localStorage.setItem(COORDS_KEY, JSON.stringify({ lat, lon }));
      window.dispatchEvent(new CustomEvent("cs:address", { detail: addr }));
      window.dispatchEvent(new CustomEvent("cs:coords", { detail: { lat, lon } }));
    } catch {}
  }, []);

  // 依風險產生/更新本地天氣告警（供鈴鐺顯示）
  const publishWeatherFromRisk = useCallback(
    (rt: RiskText, addr: string, lat: number, lon: number, weather?: RiskResponse["weather"]) => {
      const cell = roundCell(lat, lon, 3);
      const clusterId = `weather#${cell}`;

      // 低風險 → 移除
      if (rt === "Low Risk") {
        removeWeatherAlert(clusterId);
        return;
      }

      // 文案（可帶上 API 回來的數字）
      const wind = weather?.windSpeed != null ? `~${Math.round(Number(weather.windSpeed))} m/s` : undefined;
      const rain = weather?.precipitation != null ? `${Number(weather.precipitation).toFixed(1)} mm/h` : undefined;
      const details = [wind && `winds (${wind})`, rain && `rain (${rain})`].filter(Boolean).join(" or ");

      const sev: WeatherAlert["severity"] = rt === "High Risk" ? "high" : "medium";
      const desc =
        rt === "High Risk"
          ? `Severe Weather Warning. ${details || "Strong winds or heavy rain"}. Reduced visibility and hazardous conditions.`
          : `Weather Advisory. ${details || "Gusty winds or rain expected"}. Use caution while cycling.`;
      const ttlMin = rt === "High Risk" ? 30 : 20;

      const alert: WeatherAlert = {
        clusterId,
        incidentType: "severe_weather",
        description: desc,
        severity: sev,
        expiresAt: Math.floor(Date.now() / 1000) + ttlMin * 60,
        ackable: false,
        photoUrls: [],
        address: addr,
        agoText: "0 minutes ago",
      };
      upsertWeatherAlert(alert);
    },
    []
  );

  // 抓風險 + 地址
  const fetchRisk = useCallback(
    async (lat: number, lon: number) => {
      try {
        const url = new URL(API);
        url.searchParams.set("lat", String(lat));
        url.searchParams.set("lon", String(lon));
        const res = await fetch(url.toString(), { cache: "no-store" });
        const data: RiskResponse = await res.json();

        const addr = data.address || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        setRiskLevel(Math.round(data.risk || 0));
        setRiskText(data.riskText || "Low Risk");
        setAddress(addr);
        broadcastAddressAndCoords(addr, lat, lon);

        // ⭐ 天氣同步到鈴鐺
        publishWeatherFromRisk(data.riskText || "Low Risk", addr, lat, lon, data.weather);
      } catch (e) {
        console.error("fetch risk failed:", e);
        const addr = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        setAddress(addr);
        broadcastAddressAndCoords(addr, lat, lon);
      }
    },
    [broadcastAddressAndCoords, publishWeatherFromRisk]
  );

  // 若已授權，做一次靜默 geolocation（不打開對話框）
  const trySilentGeolocation = useCallback(async () => {
    try {
      const perm: PermissionStatus | undefined = await (navigator as any)?.permissions?.query?.({
        name: "geolocation" as PermissionName,
      });
      if (perm?.state !== "granted") return false;
      return await new Promise<boolean>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            fetchRisk(pos.coords.latitude, pos.coords.longitude);
            resolve(true);
          },
          () => resolve(false),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
        );
      });
    } catch {
      return false;
    }
  }, [fetchRisk]);

  // ===== 首次載入 =====
  useEffect(() => {
    try {
      const savedAddr = localStorage.getItem(ADDRESS_KEY);
      if (savedAddr) setAddress(savedAddr);
    } catch {}

    try {
      const saved = localStorage.getItem(COORDS_KEY);
      if (saved) {
        const { lat, lon } = JSON.parse(saved);
        if (Number.isFinite(lat) && Number.isFinite(lon)) fetchRisk(lat, lon);
        else fetchRisk(FALLBACK.lat, FALLBACK.lon);
      } else {
        fetchRisk(FALLBACK.lat, FALLBACK.lon);
      }
    } catch {
      fetchRisk(FALLBACK.lat, FALLBACK.lon);
    }

    (async () => {
      const updated = await trySilentGeolocation();
      const promptedOnce = sessionStorage.getItem(PROMPTED_ONCE_KEY) === "1";
      if (!promptedOnce && !updated) setGeoOpen(true);
    })();
  }, [fetchRisk, trySilentGeolocation]);

  // ===== 接收 Header 的「Change」事件，打開 GeoPrompt =====
  useEffect(() => {
    const onPrompt = () => setGeoOpen(true);
    window.addEventListener("cs:prompt-geo", onPrompt);
    return () => window.removeEventListener("cs:prompt-geo", onPrompt);
  }, []);

  // ===== 回到分頁才提醒／或靜默更新 =====
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (isDue()) setGeoOpen(true);
        else trySilentGeolocation();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [trySilentGeolocation]);

  // ===== 每分鐘檢查一次是否到提示間隔 =====
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (isDue() && !geoOpen) setGeoOpen(true);
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [geoOpen]);

  // ===== Alerts 總數同步（鈴鐺紅點）=====
  useEffect(() => {
    const init = parseInt(localStorage.getItem("cs.alerts.total") || "0", 10);
    setAlertCount(Number.isFinite(init) ? init : 0);
    const onAlerts = (e: Event) => {
      const total = Number((e as CustomEvent).detail?.total ?? 0);
      setAlertCount(Number.isFinite(total) ? total : 0);
    };
    window.addEventListener("cs:alerts", onAlerts);
    return () => window.removeEventListener("cs:alerts", onAlerts);
  }, []);

  // ===== GeoPrompt 回傳 =====
  const onGotCoords = (c: Coords) => {
    setGeoOpen(false);
    markPromptedNow();
    fetchRisk(c.lat, c.lon);
  };
  const onClosePrompt = () => {
    setGeoOpen(false);
    markPromptedNow();
  };

  return (
    <main className="container has-fab">
      <GeoPrompt open={geoOpen} onGotCoords={onGotCoords} onClose={onClosePrompt} />

      {/* 已移除地址段落，地址只在 Header 顯示 */}

      <section className="alert-card-wrapper">
        <RiskHeaderCard
          title="Safety Alerts"
          icon={<img src={alertIcon} alt="alert" />}
          riskLevel={riskLevel}
        />
        <RiskBodyCard countOverride={alertCount} actionLink="/alerts" actionText="View Details">
          <Link to="/report" className="btn-outline">
            Report Incident
          </Link>
        </RiskBodyCard>
      </section>

      <FlatCard
        title="Safe Routing"
        subtitle="Plan your safest route"
        icon={<img src={routeIcon} alt="route" />}
        actionText="Plan Route"
        actionLink="/plan-route"
        links={[
          { text: "4 safe routes available", className: "success" },
          { text: "🤖 AI-powered recommendations", className: "info" },
        ]}
      />

      <FlatCard
        title="Data Insights"
        subtitle="Safety statistics & trends"
        icon={<img src={insightIcon} alt="insight" />}
        actionText="View Insights"
        actionLink="/insights"
        links={[
          { text: "Melbourne cycling data", className: "purple" },
          { text: "30–39 age insights", className: "orange" },
        ]}
      />

      {/* 右下角小圓 FAB（行動/平板/桌機皆適配） */}
      <ReportFab />
    </main>
  );
}