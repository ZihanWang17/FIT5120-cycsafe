import { Link, useLocation } from "react-router-dom";
import "./ReportFab.css";
import reportFabIcon from "../assets/fab-report.svg"; // ← 新圖示

export default function ReportFab() {
  const { pathname } = useLocation();
  if (pathname.startsWith("/report")) return null;

  return (
    <div className="report-fab-wrap" aria-live="polite">
      <Link to="/report" className="report-fab-mini" aria-label="Report incident">
        <img src={reportFabIcon} alt="" />
      </Link>
      <span className="report-fab-tooltip">Report</span>
    </div>
  );
}