// src/components/RiskBodyCard.tsx
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import "./RiskBodyCard.css";

interface RiskBodyCardProps {
  details?: string;            // 預設描述（例如 "3 active alerts in your area"）
  countOverride?: number;      // 父層強制指定 alert 數量
  actionText?: string;
  actionLink?: string;
  children?: React.ReactNode;
}

export default function RiskBodyCard({
  details,
  countOverride,
  actionText,
  actionLink,
  children,
}: RiskBodyCardProps) {
  // 初始值
  const initial = Number(localStorage.getItem("cs.alertCount") || "0") || 0;
  const [alertCount, setAlertCount] = useState<number>(
    typeof countOverride === "number" ? countOverride : initial
  );

  useEffect(() => {
    if (typeof countOverride === "number") {
      // 父層直接傳 countOverride → 覆蓋數字
      setAlertCount(countOverride);
      return;
    }

    // 沒有 countOverride → 用事件/localStorage 更新
    const onUpdate = (e: Event) => {
      const n =
        (e as CustomEvent<number>).detail ??
        Number(localStorage.getItem("cs.alertCount") || "0");
      setAlertCount(Number.isFinite(n) ? n : 0);
    };

    window.addEventListener("cs:alertsUpdate", onUpdate as EventListener);

    const onStorage = (e: StorageEvent) => {
      if (e.key === "cs.alertCount") {
        const n = Number(e.newValue || "0");
        setAlertCount(Number.isFinite(n) ? n : 0);
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("cs:alertsUpdate", onUpdate as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [countOverride]);

  // 顯示的字串
  const leftText =
    typeof alertCount === "number"
      ? `${alertCount} active alerts in your area`
      : details ?? "";

  return (
    <div className="risk-body">
      {/* 左邊：上文字、下按鈕 */}
      <div className="rb-left">
        <div className="rb-details">
          <span className="rb-dot" aria-hidden="true" />
          <span className="rb-text">{leftText}</span>
        </div>
        <div className="rb-action">{children}</div>
      </div>

      {/* 右邊：View Details */}
      <div className="rb-right">
        {actionText && actionLink && (
          <Link to={actionLink} className="rb-link">
            {actionText} →
          </Link>
        )}
      </div>
    </div>
  );
}