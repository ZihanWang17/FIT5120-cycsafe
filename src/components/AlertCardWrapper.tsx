import RiskHeaderCard from "./RiskHeaderCard";
import RiskBodyCard from "./RiskBodyCard";
import "./AlertCardWrapper.css";

interface AlertCardWrapperProps {
  title: string;
  riskLevel: number;
  riskText: "Low Risk" | "Medium Risk" | "High Risk";
  details: string;
  actionText?: string;        // ✅ 可選
  actionLink?: string;        // ✅ 可選
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

export default function AlertCardWrapper({
  title,
  riskLevel,
  riskText,
  details,
  actionText,
  actionLink,
  icon,
  children,
}: AlertCardWrapperProps) {
  return (
    <section className="alert-card-wrapper">
      <RiskHeaderCard
        title={title}
        riskLevel={riskLevel}
        riskText={riskText}
        icon={icon}
      />
      {/* 直接把可選 props 往下傳；由子元件自行判斷是否渲染 */}
      <RiskBodyCard
        details={details}
        actionText={actionText}
        actionLink={actionLink}
      >
        {children}
      </RiskBodyCard>
    </section>
  );
}