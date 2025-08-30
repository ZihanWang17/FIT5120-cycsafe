/* Centralised network helpers + app APIs */

export type Abortable = { signal?: AbortSignal };

async function fetchJSON<T>(url: string, opts: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "AbortError")), opts.timeoutMs ?? 20000);
  if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort(opts.signal!.reason), { once: true });

  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/* ===== VIC feeds (exposed if you want to reuse them elsewhere) ===== */
type VicGeoJson = { type: "FeatureCollection"; features: any[] };

export async function getVicEvents(signal?: AbortSignal) {
  const url = "https://emergency.vic.gov.au/public/events-geojson.json";
  try {
    const j = await fetchJSON<VicGeoJson>(url, { timeoutMs: 20000, signal });
    return Array.isArray(j?.features) ? j.features : [];
  } catch (e: any) {
    if (e?.name === "AbortError") return [];
    throw e;
  }
}
export async function getVicImpactAreas(signal?: AbortSignal) {
  const url = "https://emergency.vic.gov.au/public/impact-areas-geojson.json";
  try {
    const j = await fetchJSON<VicGeoJson>(url, { timeoutMs: 20000, signal });
    return Array.isArray(j?.features) ? j.features : [];
  } catch (e: any) {
    if (e?.name === "AbortError") return [];
    throw e;
  }
}

/* ===== Incidents (for ReportIncident & QuickReportModal) ===== */

export type CreateIncidentPayload = {
  Timestamp: string;
  Incident_severity: "low" | "medium" | "high" | "critical";
  Incident_description: string;
  Latitude?: number | null;
  Longitude?: number | null;
  LGA?: string;
  Verification: "pending" | "approved" | "rejected";
  Picture?: string[];
  Incident_type: string;
  Incident_type_desc: string;
};

export async function createIncident(payload: CreateIncidentPayload) {
  const res = await fetch("/api/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to create incident");
  return res.json();
}

/** Minimal submit used by QuickReportModal */
export async function submitIncident(payload: {
  Incident_type: string;
  latitude: number;
  longitude: number;
  description?: string;
}) {
  const res = await fetch("/api/incidents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      Incident_type: payload.Incident_type,
      Incident_description: payload.description ?? "",
      Latitude: payload.latitude,
      Longitude: payload.longitude,
      Timestamp: new Date().toISOString(),
      Verification: "pending",
    }),
  });
  if (!res.ok) throw new Error("Failed to submit incident");
  return res.json();
}

/** Pre-signed upload helper for photos */
export async function getUploadUrl(filename: string, contentType = "image/jpeg") {
  const res = await fetch(
    `/api/uploads/presign?name=${encodeURIComponent(filename)}&type=${encodeURIComponent(contentType)}`
  );
  if (!res.ok) throw new Error("Failed to get upload URL");
  return (await res.json()) as { url: string; key: string };
}