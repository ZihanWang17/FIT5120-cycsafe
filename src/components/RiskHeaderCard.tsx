// src/components/RiskHeaderCard.tsx
import "./RiskHeaderCard.css";
import { useEffect, useRef, useState } from "react";
import { triggerRiskAlert } from "../lib/notify";
import type { Severity } from "../lib/notify"; // "none" | "medium" | "high"

// Allow both "MEDIUM" and "MED"
type SeverityLabel = "LOW" | "MED" | "MEDIUM" | "HIGH";

interface RiskHeaderCardProps {
  title: string;
  icon?: React.ReactNode;
  /** 受控：如果父層直接給數值百分比（0–100）就用這個 */
  riskLevel?: number;
  /** 受控：如果父層直接給等級字樣（LOW/MED/MEDIUM/HIGH）就用這個 */
  riskText?: SeverityLabel;
  /** ⬅️ NEW: small chip element (emoji + text) shown above the status line */
  weatherChip?: React.ReactNode;
}

const RISK_API = import.meta.env.VITE_LAMBDA_URL as string;
const MED_T = Number(import.meta.env.VITE_MEDIUM_RISK ?? 40);
const HIGH_T = Number(import.meta.env.VITE_HIGH_RISK ?? 70);
const REFRESH_MS = Number(import.meta.env.VITE_REFRESH_MS ?? 60000);

// 轉數字（保險）
const toInt = (v: unknown, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : d;
};

// 數值 → 等級字樣（LOW/MED/MEDIUM/HIGH）
const levelToLabel = (lvl: number): SeverityLabel =>
  lvl >= HIGH_T ? "HIGH" : lvl >= MED_T ? "MED" : "LOW";

// 數值 → 通知嚴重度
const levelToNotifySeverity = (lvl: number): Severity =>
  lvl >= HIGH_T ? "high" : lvl >= MED_T ? "medium" : "none";

export default function RiskHeaderCard({
  title,
  icon,
  riskLevel: riskLevelProp,
  riskText: riskTextProp,
  weatherChip, // ⬅️ NEW
}: RiskHeaderCardProps) {
  // 內部狀態（非受控時使用）
  const [riskLevelState, setRiskLevelState] = useState<number>(0);
  const [riskTextState, setRiskTextState] = useState<SeverityLabel>("LOW");
  const [status, setStatus] = useState<string>("Current risk level");

  // 定時器 & 定位
  const timerRef = useRef<number | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // 避免同等級重複通知
  const lastNotifiedRef = useRef<Severity>("none");

  /** 解析 Lambda 回傳（保留，以便無後端資料時仍可顯示） */
  const applyRisk = (data: any) => {
    const ok = typeof data?.ok === "boolean" ? data.ok : true;
    if (!ok) throw new Error(data?.error || "Lambda returned ok=false");

    const lvl = toInt(data?.risk, 0);
    const label: SeverityLabel =
      (String(data?.riskText || "").toUpperCase() as SeverityLabel) ||
      levelToLabel(lvl);

    setRiskLevelState(lvl);
    setRiskTextState(label);
    setStatus("Current risk level");

    // 🔔 嚴重度上升才通知（僅數值模式啟用）
    const sev = levelToNotifySeverity(lvl);
    const rank = (s: Severity) => (s === "none" ? 0 : s === "medium" ? 1 : 2);
    if (rank(sev) > rank(lastNotifiedRef.current)) {
      const msg =
        sev === "high"
          ? "Risk is HIGH in your area. Ride with EXTREME caution."
          : "Risk is MEDIUM in your area. Ride with caution.";
      triggerRiskAlert(sev, msg);
      lastNotifiedRef.current = sev;
    }
  };

  /** 非受控模式：定位 + 定時刷新（保留與舊後端相容） */
  useEffect(() => {
    if (typeof riskLevelProp === "number" || typeof riskTextProp === "string") {
      setStatus("Current risk level");
      return;
    }

    const isSecure =
      location.protocol === "https:" || location.hostname === "localhost";

    const start = (lat: number, lon: number) => {
      fetchRisk(lat, lon);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = window.setInterval(
        () => fetchRisk(lat, lon),
        REFRESH_MS
      );

      if ("geolocation" in navigator) {
        if (watchIdRef.current != null)
          navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = navigator.geolocation.watchPosition(
          (p) => fetchRisk(p.coords.latitude, p.coords.longitude),
          (err) => console.warn("watchPosition error:", err),
          { maximumAge: 10000, timeout: 8000 }
        );
      }
    };

    if (isSecure && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => start(pos.coords.latitude, pos.coords.longitude),
        () => {
          setStatus("Using default location");
          start(-37.8136, 144.9631); // Melbourne CBD
        },
        { maximumAge: 10000, timeout: 8000 }
      );
    } else {
      if (!isSecure) setStatus("Use HTTPS to enable location");
      start(-37.8136, 144.9631);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (watchIdRef.current != null)
        navigator.geolocation.clearWatch(watchIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskLevelProp, riskTextProp]);

  /** 抓風險（舊後端） */
  const fetchRisk = async (lat: number, lon: number) => {
    try {
      const url = new URL(RISK_API);
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lon));
      const res = await fetch(url.toString(), {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const text = await res.text();
      const json = (() => { try { return JSON.parse(text); } catch { return {}; } })();
      applyRisk(json);
    } catch (e) {
      console.error("Fetch risk failed:", e);
      setStatus("Load failed");
      setRiskLevelState(0);
      setRiskTextState("LOW");
    }
  };

  /** 最終呈現值（受控優先） */
  const effectiveLevel =
    typeof riskLevelProp === "number" ? riskLevelProp : riskLevelState;

  const effectiveTextRaw: SeverityLabel =
    (riskTextProp as SeverityLabel | undefined) ??
    (typeof riskLevelProp === "number"
      ? levelToLabel(riskLevelProp)
      : riskTextState);

  // 正規化 MED / MEDIUM → 顯示 MEDIUM（UI 統一）
  const effectiveText = effectiveTextRaw === "MED" ? "MEDIUM" : effectiveTextRaw;

  const riskClass =
    effectiveText === "HIGH" ? "high" :
    effectiveText === "MEDIUM" ? "medium" : "low";

  return (
    <div className={`risk-header ${riskClass}`}>
      <div className="rh-left">
        {icon && <span className="rh-icon">{icon}</span>}
        <div className="rh-text">
          <h3>{title}</h3>
          {/* ⬇️ NEW: tiny weather indicator above the status line */}
          {weatherChip ? <div style={{ marginTop: 4 }}>{weatherChip}</div> : null}
          <p>
            {status}
            {effectiveText === "HIGH" ? " • ⚠️ High-risk area" : ""}
          </p>
        </div>
      </div>

      {/* 右側：只顯示等級徽章 */}
      <div className="rh-right">
        <div className="rh-tag">{effectiveText}</div>
      </div>
    </div>
  );
}
