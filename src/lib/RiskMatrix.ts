// src/lib/RiskMatrix.ts
export type RiskLevel = "HIGH" | "MED" | "LOW";

export type Context = {
  lat: number;
  lon: number;
  hour: number;    // 0..23
  month: number;   // 1..12
  dow: number;     // 0..6 (Sun..Sat)
  weatherCode?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 9; // 1 clear, 2 rain, 7 wind
  roadSurfaceCode?: 1 | 2 | 3 | 4 | 5 | 9;
};

const DENOM = 172_115;

export type AccidentRow = { Accident_No: string; LAT: number; LON: number; Accident_hour: number; Accident_month: number; DAY_OF_WEEK: number; };
export type AtmosRow   = { Accident_No: string; ATMOSPH_COND: number; };
export type SurfaceRow = { Accident_No: string; SURFACE_COND: number; };

export function computeRiskLevel(
  ctx: Context,
  data?: {
    accidents?: AccidentRow[];
    atmosphere?: AtmosRow[];
    surface?: SurfaceRow[];
  }
): { riskLevel: RiskLevel; currentWeather: string } {
  const wxName = weatherName(ctx.weatherCode);

  // No historic data → heuristic fallback using weather+hour
  if (!data || !Array.isArray(data.accidents) || data.accidents.length === 0) {
    const level = weatherHeuristic(ctx.weatherCode, ctx.hour);
    return { riskLevel: level, currentWeather: wxName };
  }

  const atmIndex = new Map<string, number>();
  for (const r of data.atmosphere || []) atmIndex.set(r.Accident_No, r.ATMOSPH_COND);

  const surfIndex = new Map<string, number>();
  for (const r of data.surface || []) surfIndex.set(r.Accident_No, r.SURFACE_COND);

  const within = (acc: AccidentRow) => {
    if (!Number.isFinite(acc.LAT) || !Number.isFinite(acc.LON)) return false;
    const d = haversineM(ctx.lat, ctx.lon, acc.LAT, acc.LON);
    if (d > 250) return false;
    if (acc.Accident_hour !== ctx.hour) return false;
    if (acc.Accident_month !== ctx.month) return false;
    if (acc.DAY_OF_WEEK !== ctx.dow) return false;

    const atmos = atmIndex.get(acc.Accident_No);
    if (ctx.weatherCode != null && atmos != null && atmos !== ctx.weatherCode) return false;

    const surf = surfIndex.get(acc.Accident_No);
    if (ctx.roadSurfaceCode != null && surf != null && surf !== ctx.roadSurfaceCode) return false;

    return true;
  };

  const matched = (data.accidents || []).filter(within).length;
  const likelihood = matched / DENOM;
  const level = categorize(likelihood);
  return { riskLevel: level, currentWeather: wxName };
}

// Friendly weather name (used by UI)
export function weatherName(code?: number): string {
  switch (code) {
    case 1: return "Clear";
    case 2: return "Raining";
    case 3: return "Snowing";
    case 4: return "Fog";
    case 5: return "Smoke";
    case 6: return "Dust";
    case 7: return "Strong winds";
    case 9: return "Not known";
    default: return "Unknown";
  }
}

/* internals */
function weatherHeuristic(code?: number, hour?: number): RiskLevel {
  if (code === 7) return "HIGH";
  if (code === 2) return hour != null && (hour >= 18 || hour <= 6) ? "HIGH" : "MED";
  return "LOW";
}
function categorize(p: number): RiskLevel {
  if (p < 0.001) return "LOW";
  if (p < 0.002) return "MED";
  return "HIGH";
}
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
function toRad(d: number) { return (d * Math.PI) / 180; }