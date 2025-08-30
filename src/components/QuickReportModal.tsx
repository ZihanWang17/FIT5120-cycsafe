// src/components/QuickReportModal.tsx
import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, FormControl, Select, MenuItem, CircularProgress, Box, TextField
} from "@mui/material";
import { INCIDENT_TYPES } from "../pages/IncidentTypeSelect";
import type { IncidentTypeCode } from "../pages/IncidentTypeSelect";
import { submitIncident } from "../lib/api";

export default function QuickReportModal({ open, onClose }: { open: boolean; onClose: () => void; }) {
  const [type, setType] = useState<IncidentTypeCode | "">("");
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [geo, setGeo] = useState<{ lat: number; lon: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<"ok" | "fail" | null>(null);

  // prefer the location bus (updates every 5s)
  useEffect(() => {
    if (!open) return;
    const onCoords = (e: Event) => {
      const d = (e as CustomEvent).detail as { lat?: number; lon?: number } | undefined;
      if (Number.isFinite(d?.lat) && Number.isFinite(d?.lon)) setGeo({ lat: d!.lat!, lon: d!.lon! });
    };
    window.addEventListener("cs:coords", onCoords);

    // seed from cache
    try {
      const saved = localStorage.getItem("cs.coords");
      if (saved) {
        const { lat, lon } = JSON.parse(saved);
        if (Number.isFinite(lat) && Number.isFinite(lon)) setGeo({ lat, lon });
      }
    } catch {}

    // just in case: quick one-shot geolocate
    if (!geo && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setGeo({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
      );
    }
    return () => window.removeEventListener("cs:coords", onCoords);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canSubmit = useMemo(() => !!type && !!geo && !busy, [type, geo, busy]);

  const onSubmit = async () => {
    if (!canSubmit || !geo) return;
    setBusy(true);
    setErr(null);
    try {
      await submitIncident({
        Incident_type: type as IncidentTypeCode,
        description: note || "",
        latitude: geo.lat,
        longitude: geo.lon,
      });
      setDone("ok");
      setTimeout(() => {
        onClose();
        setType("");
        setNote("");
        setDone(null);
      }, 800);
    } catch (e: any) {
      setErr(e?.message || "Failed to submit. Please try again.");
      setDone("fail");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Quick Report</DialogTitle>
      <DialogContent dividers>
        <FormControl fullWidth sx={{ mb: 1.25 }}>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as IncidentTypeCode)}
            displayEmpty
          >
            <MenuItem value=""><em>Select incident type</em></MenuItem>
            {INCIDENT_TYPES.map(t => (
              <MenuItem key={t.value ?? t.code ?? t.label} value={(t.value ?? t.code) as IncidentTypeCode}>
                {t.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          fullWidth
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What happened?"
          minRows={2}
          multiline
        />

        <Box sx={{ mt: 1, fontSize: 12, color: "#6b7280" }}>
          {geo ? `Using location • ${geo.lat.toFixed(5)}, ${geo.lon.toFixed(5)}` : "Getting your location…"}
        </Box>
        {err && <Box sx={{ mt: 1, color: "#b91c1c", fontSize: 13 }}>{err}</Box>}
        {done === "ok" && <Box sx={{ mt: 1, color: "#16a34a", fontSize: 13, fontWeight: 700 }}>Submitted!</Box>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={onSubmit} variant="contained" disabled={!canSubmit} startIcon={busy ? <CircularProgress size={16} /> : null}>
          Submit
        </Button>
      </DialogActions>
    </Dialog>
  );
}