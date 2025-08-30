// Updated RiskBodyCard component
// This component renders the bottom half of the safety alert card. It displays
// the number of active alerts in the user's area along with a call-to-action
// link and a slot for additional children (e.g. a report incident button).

import "./RiskBodyCard.css";
import { useEffect, useState, ReactNode } from "react";
import { Link } from "react-router-dom";

interface RiskBodyCardProps {
  /** If provided, overrides the alert count shown */
  countOverride?: number;
  /** Link destination for the action on the right */
  actionLink?: string;
  /** Text to display for the action on the right */
  actionText?: string;
  /** Children rendered as the call-to-action on the left (e.g. Report button) */
  children?: ReactNode;
}

export default function RiskBodyCard({
  countOverride,
  actionLink,
  actionText,
  children,
}: RiskBodyCardProps) {
  const [count, setCount] = useState<number>(() => {
    if (typeof countOverride === "number") return countOverride;
    const init = parseInt(localStorage.getItem("cs.alerts.total") || "0", 10);
    return Number.isFinite(init) ? init : 0;
  });

  // Subscribe to alert count updates from alertsService
  useEffect(() => {
    const onAlerts = (e: Event) => {
      const total = Number((e as CustomEvent).detail?.total ?? 0);
      setCount(Number.isFinite(total) ? total : 0);
    };
    window.addEventListener("cs:alerts", onAlerts);
    return () => window.removeEventListener("cs:alerts", onAlerts);
  }, []);

  return (
    <div className="risk-body">
      <div className="rb-left">
        <div className="rb-details">
          <span className="rb-dot"></span>
          <span className="rb-text">{count} active alerts in your area</span>
        </div>
        <div className="rb-action">{children}</div>
      </div>
      <div className="rb-right">
        {actionLink && actionText ? (
          <Link to={actionLink} className="rb-link">
            {actionText} →
          </Link>
        ) : null}
      </div>
    </div>
  );
}