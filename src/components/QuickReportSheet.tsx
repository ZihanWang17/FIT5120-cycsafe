// QuickReportSheet provides a bottom sheet UI for submitting quick incident
// reports. It displays a list of common incident types with emojis. When a
// type is selected, it will send the report to the backend (see
// services/incidentService.ts) along with the user's current coordinates.

import "./QuickReportSheet.css";
import { useEffect, useRef } from "react";
import { submitQuickIncident } from "../services/incidentService";

interface QuickReportSheetProps {
  open: boolean;
  onClose: () => void;
  /** Optional locality label to show at the top of the sheet */
  localityLabel?: string;
}

type Item = { code: string; label: string; emoji: string };

// Define the list of quick incident types. The `code` should match the
// expected values in the backend (Incident_type). Feel free to adjust
// these according to your schema.
const ITEMS: Item[] = [
  { code: "VEHICLE_COLLISION", label: "Collision", emoji: "🚗" },
  { code: "NEAR_MISS", label: "Near Miss", emoji: "⚠️" },
  { code: "ROAD_HAZARD", label: "Road Hazard", emoji: "🕳️" },
  { code: "AGGRESSIVE_DRIVER", label: "Aggressive Driver", emoji: "😡" },
  { code: "POOR_INFRA", label: "Poor Infrastructure", emoji: "🚧" },
  { code: "OTHER", label: "Other", emoji: "❓" },
];

export default function QuickReportSheet({ open, onClose, localityLabel }: QuickReportSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // Close on escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Submit the selected incident type
  const handleSelect = async (code: string) => {
    try {
      await submitQuickIncident(code);
    } catch (e) {
      console.error("quick incident submit failed", e);
    } finally {
      onClose();
    }
  };

  return (
    <div className={`qr-overlay ${open ? "show" : ""}`} onClick={onClose}>
      <div
        className={`qr-sheet ${open ? "slide-up" : ""}`}
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="qr-header">
          <div className="qr-title-block">
            <span className="qr-flash">⚡</span>
            <div>
              <div className="qr-title">Quick Report</div>
              <div className="qr-subtitle">Tap incident type to report</div>
            </div>
          </div>
          <button className="qr-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {localityLabel && (
          <div className="qr-location">
            <span className="qr-location-label">{localityLabel}</span>
          </div>
        )}
        <div className="qr-list">
          {ITEMS.map((item) => (
            <button key={item.code} className="qr-item" onClick={() => handleSelect(item.code)}>
              <span className="qr-emoji">{item.emoji}</span>
              <span className="qr-label">{item.label}</span>
            </button>
          ))}
        </div>
        <div className="qr-note">
          <strong>Quick reports</strong> help us track incidents rapidly. For detailed reports
          with photos and descriptions, use the main <em>Report Incident</em> button.
        </div>
      </div>
    </div>
  );
}