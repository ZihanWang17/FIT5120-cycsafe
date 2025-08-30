import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";

import RiskHeaderCard from "../components/RiskHeaderCard";
import RiskBodyCard from "../components/RiskBodyCard";
import "../components/AlertCardWrapper.css";
import FlatCard from "../components/FlatCard";
import GeoPrompt, { type Coords } from "../components/GeoPrompt";
import ReportFab from "../components/ReportFab";

import alertIcon from "../assets/alert.svg";
import routeIcon from "../assets/route.svg";
import insightIcon from "../assets/insight.svg";
import { computeRiskLevel } from "../lib/RiskMatrix";

/* Types for responses returned by the risk API */
type RiskText = "LOW" | "MED" | "HIGH";
type RiskResponse = {
  ok: boolean;
  risk?: number;
  riskText?: "Low Risk" | "Medium Risk" | "High Risk";
  address?: string;
  lat?: number;
  lon?: number;
  weather?: { windSpeed?: number; precipitation?: number; temperature?: number };
  atmosphere?: string;
};

// Base URL for the Lambda or API endpoint. Falls back to a default if not defined.
const API =
  import.meta.env.VITE_LAMBDA_URL ??
  "https://dbetjhlyj7smwrgcptcozm6amq0ovept.lambda-url.ap-southeast-2.on.aws/";

// Timing settings: how often to prompt for geolocation again
const PROMPT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// Keys for storing address and coordinates in local/session storage
const ADDRESS_KEY = "cs.address";
const COORDS_KEY = "cs.coords";
const PROMPTED_ONCE_KEY = "cs.loc.promptedOnce";
const LAST_PROMPT_TS_KEY = "cs.loc.lastPromptTs";

// Fallback coordinates (Melbourne CBD) if we can't get a location
const FALLBACK = { lat: -37.8136, lon: 144.9631 };

// Helpers for rounding coordinates to a cell for weather alerts
type WeatherAlert = {
  clusterId: string;
  incidentType: "severe_weather";
  description: string;
  severity: "low" | "medium" | "high";
  expiresAt: number;
  ackable: false;
  photoUrls?: string[];
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
  try {
    list = JSON.parse(localStorage.getItem("cs.weather.alerts") || "[]") || [];
  } catch {}
  const idx = list.findIndex((x) => x.clusterId === a.clusterId);
  if (idx === -1) list.push(a);
  else list[idx] = a;
  localStorage.setItem("cs.weather.alerts", JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("cs:weather:list"));
}

function removeWeatherAlert(clusterId: string) {
  let list: WeatherAlert[] = [];
  try {
    list = JSON.parse(localStorage.getItem("cs.weather.alerts") || "[]") || [];
  } catch {}
  const next = list.filter((x) => x.clusterId !== clusterId);
  localStorage.setItem("cs.weather.alerts", JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("cs:weather:list"));
}

// Helpers for deriving a human-readable weather label and emoji from API data
function weatherLabelFrom(weather?: RiskResponse["weather"]) {
  const ws = Number(weather?.windSpeed ?? 0);
  const pr = Number(weather?.precipitation ?? 0);
  if (pr >= 1) return "Rainy";
  if (ws >= 12) return "Windy";
  return "Clear";
}

function weatherEmoji(text?: string | null) {
  if (!text) return "⛅️";
  const t = text.toLowerCase();
  if (t.includes("rain")) return "🌧️";
  if (t.includes("wind")) return "💨";
  if (t.includes("fog") || t.includes("mist")) return "🌫️";
  if (t.includes("cloud")) return "⛅️";
  return "☀️";
}

export default function Home() {
  const navigate = useNavigate();

  // Display state: risk severity ("LOW" | "MED" | "HIGH"), alert count, weather text for emoji
  const [riskTextOnly, setRiskTextOnly] = useState<RiskText>("LOW");
  const [alertCount, setAlertCount] = useState<number>(0);
  const [weatherText, setWeatherText] = useState<string>("");

  // Whether to show the geolocation prompt dialog
  const [geoOpen, setGeoOpen] = useState<boolean>(false);

  // Mark that we've prompted for location at least once and record timestamp
  const markPromptedNow = () => {
    sessionStorage.setItem(PROMPTED_ONCE_KEY, "1");
    sessionStorage.setItem(LAST_PROMPT_TS_KEY, String(Date.now()));
  };

  // Determine if enough time has passed to re-prompt for location
  const isDue = () => {
    const last = Number(sessionStorage.getItem(LAST_PROMPT_TS_KEY) || 0);
    return Date.now() - last >= PROMPT_INTERVAL_MS;
  };

  // Broadcast address and coordinates to localStorage and dispatch events for listeners
  const broadcastAddressAndCoords = useCallback((addr: string, lat: number, lon: number) => {
    try {
      localStorage.setItem(ADDRESS_KEY, addr);
      localStorage.setItem(COORDS_KEY, JSON.stringify({ lat, lon }));
      window.dispatchEvent(new CustomEvent("cs:address", { detail: addr }));
      window.dispatchEvent(new CustomEvent("cs:coords", { detail: { lat, lon } }));
    } catch {}
  }, []);

  // Publish or remove a weather alert based on risk level
  const publishWeatherFromRisk = useCallback(
    (
      rt: "Low Risk" | "Medium Risk" | "High Risk",
      addr: string,
      lat: number,
      lon: number,
      weather?: RiskResponse["weather"]
    ) => {
      const cell = roundCell(lat, lon, 3);
      const clusterId = `weather#${cell}`;

      if (rt === "Low Risk") {
        removeWeatherAlert(clusterId);
        return;
      }

      const wind = weather?.windSpeed != null ? `~${Math.round(Number(weather.windSpeed))} m/s` : undefined;
      const rain = weather?.precipitation != null ? `${Number(weather.precipitation).toFixed(1)} mm/h` : undefined;
      const details = [wind && `winds (${wind})`, rain && `rain (${rain})`].filter(Boolean).join(" or ");

      const sev: WeatherAlert["severity"] = rt === "High Risk" ? "high" : "medium";
      const desc =
        rt === "High Risk"
          ? `Severe Weather Warning. ${details || "Strong winds or heavy rain"}. Reduced visibility and hazardous conditions.`
          : `Weather Advisory. ${details || "Gusty winds or rain expected"}. Ride with caution.`;
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

  // Fetch risk data, compute local risk using RiskMatrix, update state, and publish alerts
  const fetchRisk = useCallback(
    async (lat: number, lon: number) => {
      try {
        const url = new URL(API);
        url.searchParams.set("lat", String(lat));
        url.searchParams.set("lon", String(lon));
        const res = await fetch(url.toString(), { cache: "no-store" });
        const data: RiskResponse = await res.json().catch(() => ({} as RiskResponse));

        const addr = data.address || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        broadcastAddressAndCoords(addr, lat, lon);

        // Compute a coarse weather code: 1 Clear, 2 Rain, 7 Windy (align with risk matrix)
        const wxCode: 1 | 2 | 7 =
          Number(data.weather?.windSpeed ?? 0) >= 12 ? 7 : Number(data.weather?.precipitation ?? 0) >= 1 ? 2 : 1;
        const now = new Date();
        const result = computeRiskLevel({
          lat,
          lon,
          hour: now.getHours(),
          month: now.getMonth() + 1,
          dow: now.getDay(),
          weatherCode: wxCode,
        });

        // Update UI state
        setRiskTextOnly(result.riskLevel);
        setWeatherText(weatherLabelFrom(data.weather));

        // Publish or remove severe weather warnings
        publishWeatherFromRisk(
          result.riskLevel === "HIGH" ? "High Risk" : result.riskLevel === "MED" ? "Medium Risk" : "Low Risk",
          addr,
          lat,
          lon,
          data.weather
        );
      } catch (e) {
        console.error("fetch risk failed:", e);
        const addr = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        broadcastAddressAndCoords(addr, lat, lon);
        setRiskTextOnly("LOW");
        setWeatherText("");
      }
    },
    [broadcastAddressAndCoords, publishWeatherFromRisk]
  );

  // Try a silent geolocation attempt if permission is already granted
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

  /** ===== On first mount ===== */
  useEffect(() => {
    // Attempt to load previous coordinates from local storage
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

    // Try to refresh location silently, otherwise prompt (once)
    (async () => {
      const updated = await trySilentGeolocation();
      const promptedOnce = sessionStorage.getItem(PROMPTED_ONCE_KEY) === "1";
      if (!promptedOnce && !updated) setGeoOpen(true);
    })();
  }, [fetchRisk, trySilentGeolocation]);

  // Listen for global events that ask us to show the geo prompt
  useEffect(() => {
    const onPrompt = () => setGeoOpen(true);
    window.addEventListener("cs:prompt-geo", onPrompt);
    return () => window.removeEventListener("cs:prompt-geo", onPrompt);
  }, []);

  // When page becomes visible or regains focus, decide whether to prompt again or refresh location
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

  // Periodically check if we should show the geo prompt again (e.g. after 10 minutes)
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (isDue() && !geoOpen) setGeoOpen(true);
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [geoOpen]);

  // Listen for alert count updates (for the "X active alerts" text)
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

  // Handlers for the GeoPrompt (triggered by user)
  const onGotCoords = (c: Coords) => {
    setGeoOpen(false);
    markPromptedNow();
    fetchRisk(c.lat, c.lon);
  };
  const onClosePrompt = () => {
    setGeoOpen(false);
    markPromptedNow();
  };

  // Derive the weather emoji and proper risk text for the header card
  const weatherIcon = useMemo(() => weatherEmoji(weatherText), [weatherText]);
  const riskTextForHeader: "LOW" | "MEDIUM" | "HIGH" =
    riskTextOnly === "MED" ? "MEDIUM" : (riskTextOnly as "LOW" | "HIGH");

  return (
    <main className="container has-fab">
      {/* GeoPrompt for requesting location (modal) */}
      <GeoPrompt open={geoOpen} onGotCoords={onGotCoords} onClose={onClosePrompt} />

      {/* Safety alerts card: header + body */}
      <section className="alert-card-wrapper">
        <RiskHeaderCard
          title="Safety Alerts"
          icon={<img src={alertIcon} alt="alert" />}
          riskText={riskTextForHeader}
          weatherEmoji={weatherIcon}
          onViewDetails={() => navigate("/alerts")}
          onReportIncident={() => navigate("/report")}
        />
        <RiskBodyCard countOverride={alertCount} actionLink="/alerts" actionText="View Details">
          <Link to="/report" className="btn-outline">
            Report Incident
          </Link>
        </RiskBodyCard>
      </section>

      {/* Safe Routing placeholder */}
      <FlatCard
        title="Safe Routing"
        subtitle="Plan your safest route"
        icon={<img src={routeIcon} alt="route" />}
        actionText="Plan Route"
        actionLink="/plan-route"
        links={[
          { text: "Feature coming soon", className: "info" },
          { text: "Stay tuned!", className: "purple" },
        ]}
      />

      {/* Data Insights placeholder */}
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

      {/* Floating action button for Quick Report */}
      <ReportFab />
    </main>
  );
}