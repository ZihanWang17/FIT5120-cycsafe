import { useLocation } from "react-router-dom";
import "./ReportFab.css";
import reportFabIcon from "../assets/fab-report.svg";
import { useState } from "react";
import QuickReportModal from "./QuickReportModal";

export default function ReportFab() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  // 在完整回報頁就隱藏 FAB（以免重複）
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

      <QuickReportModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
