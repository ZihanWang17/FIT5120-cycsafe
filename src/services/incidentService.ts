// Service for submitting quick incident reports
// This function collects the latest known coordinates from localStorage (as
// written by the location bus) or falls back to the browser geolocation API.
// It then sends a POST request to the configured endpoint with the
// incident type, coordinates and timestamp. Adjust the endpoint as
// necessary for your backend (see VITE_INCIDENT_API_URL in your .env).

export async function submitQuickIncident(incidentType: string) {
  // Try to read cached coords from localStorage (written by locationBus)
  let coords: { lat: number; lon: number } | null = null;
  try {
    const saved = localStorage.getItem("cs.coords");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Number.isFinite(parsed?.lat) && Number.isFinite(parsed?.lon)) {
        coords = { lat: parsed.lat, lon: parsed.lon };
      }
    }
  } catch {
    // ignore
  }

  // Fall back to geolocation if nothing cached
  if (!coords && "geolocation" in navigator) {
    coords = await new Promise<{ lat: number; lon: number } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
      );
    });
  }

  // Determine API base from environment variables. You can configure
  // VITE_INCIDENT_API_URL or VITE_API_BASE in your .env; otherwise default to
  // "/api" which will proxy to your backend if using Vite dev server.
  const base: string =
    (import.meta.env.VITE_INCIDENT_API_URL as string) ||
    (import.meta.env.VITE_API_BASE as string) ||
    (import.meta.env.VITE_LAMBDA_URL as string) ||
    "";
  const endpoint = base ? `${base.replace(/\/$/, "")}/incident-report` : "/api/incident-report";

  const payload = {
    Incident_type: incidentType,
    latitude: coords?.lat ?? null,
    longitude: coords?.lon ?? null,
    createdAt: new Date().toISOString(),
    source: "quick",
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to submit incident: ${res.status} ${text}`);
  }
  return res.json().catch(() => ({}));
}