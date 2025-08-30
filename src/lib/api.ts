// src/lib/api.ts
export type CreateIncidentPayload = {
  Timestamp: string;
  Incident_severity: "low" | "medium" | "high" | "critical";
  Incident_description: string;
  Latitude?: number;
  Longitude?: number;
  LGA?: string;
  Verification?: "pending" | "verified" | "rejected";
  Picture?: string[];               // S3 keys 或 URLs
  Incident_type: string;            // 代碼，如 "ROAD_HAZARD"
  Incident_type_desc?: string;      // 描述，如 "Road Hazard"
  Contact?: string;                 // 可選，Email / Phone
};

// 從 .env 讀取
const CREATE_URL = import.meta.env.VITE_API_CREATE_INCIDENT as string | undefined;
const UPLOAD_URL = import.meta.env.VITE_API_UPLOAD_IMAGE as string | undefined;
const BUCKET     = import.meta.env.VITE_UPLOAD_BUCKET as string | undefined;
const PREFIX     = import.meta.env.VITE_UPLOAD_PREFIX as string | undefined;

/** 建立事故事件 (呼叫 createIncident Lambda) */
export async function createIncident(payload: CreateIncidentPayload) {
  if (!CREATE_URL) throw new Error("Missing VITE_API_CREATE_INCIDENT");

  const res = await fetch(CREATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.message || "Failed to create incident");
  }
  return data as { ok: true; INCIDENT_NO: string; Timestamp: string };
}

/** 取得 S3 上傳 URL（由 incidentImageUploadUrl Lambda 回傳） */
export async function getUploadUrl(filename: string, contentType: string) {
  if (!UPLOAD_URL) throw new Error("Missing VITE_API_UPLOAD_IMAGE");

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename,
      contentType,
      bucket: BUCKET,
      prefix: PREFIX,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.url || !data?.key) {
    throw new Error(data?.message || "Failed to get upload URL");
  }

  // 例如 { ok:true, url: <signed PUT url>, key: "incidents/2025/0827/xxx.jpg" }
  return data as { ok: true; url: string; key: string };
}