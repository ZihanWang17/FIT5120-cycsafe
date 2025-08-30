// Simple "location bus": push fresh coords every ~5s to window + cache
const KEY = "cs.coords";

let started = false;
let intervalId: number | null = null;
let watchId: number | null = null;

export function startLocationBus() {
  if (started) return;
  started = true;

  const emit = (lat: number, lon: number) => {
    try { localStorage.setItem(KEY, JSON.stringify({ lat, lon })); } catch {}
    window.dispatchEvent(new CustomEvent("cs:coords", { detail: { lat, lon } }));
  };

  // seed from cache once
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const { lat, lon } = JSON.parse(saved);
      if (Number.isFinite(lat) && Number.isFinite(lon)) emit(lat, lon);
    }
  } catch {}

  if ("geolocation" in navigator) {
    // live updates when device moves
    watchId = navigator.geolocation.watchPosition(
      (p) => emit(p.coords.latitude, p.coords.longitude),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );

    // gentle poll as a fallback (every 5s)
    intervalId = window.setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (p) => emit(p.coords.latitude, p.coords.longitude),
        () => {},
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 5000 }
      );
    }, 5000);
  }
}

export function stopLocationBus() {
  if (watchId != null && "geolocation" in navigator) navigator.geolocation.clearWatch(watchId);
  if (intervalId != null) window.clearInterval(intervalId);
  started = false;
  intervalId = null;
  watchId = null;
}