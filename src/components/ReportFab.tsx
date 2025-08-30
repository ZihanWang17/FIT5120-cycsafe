// Floating action button for quick incident reporting. When tapped it opens
// the QuickReportSheet bottom sheet. Hidden on pages under "/report" to
// avoid duplication.

import { useState } from "react";
import { useLocation } from "react-router-dom";
import QuickReportSheet from "./QuickReportSheet";
import reportFabIcon from "../assets/fab-report.svg";
import "./ReportFab.css";

export default function ReportFab() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  // Hide the FAB when already on the full report page
  if (pathname.startsWith("/report")) return null;

  return (
    <>
      <div className="report-fab-wrap" aria-live="polite">
        <button
          type="button"
          className="report-fab-mini"
          aria-label="Quick report incident"
          onClick={() => setOpen(true)}
        >
          <img src={reportFabIcon} alt="" />
        </button>
        <span className="report-fab-tooltip">Quick Report</span>
      </div>
      <QuickReportSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}