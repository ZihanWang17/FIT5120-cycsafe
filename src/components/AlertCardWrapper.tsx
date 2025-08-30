import RiskHeaderCard from "./RiskHeaderCard";
import RiskBodyCard from "./RiskBodyCard";
import "./AlertCardWrapper.css";

interface AlertCardWrapperProps {
  title: string;
  riskLevel: number;
  riskText: "LOW" | "MED" | "MEDIUM" | "HIGH";
  details: string;
  actionText?: string;
  actionLink?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  /** Tiny chip above the status line – e.g. the weather emoji + text */
  weatherChip?: React.ReactNode;
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
  weatherChip,
}: AlertCardWrapperProps) {
  return (
    <section className="alert-card-wrapper">
      <RiskHeaderCard
        title={title}
        riskLevel={riskLevel}
        riskText={riskText}
        icon={icon}
        weatherChip={weatherChip}
      />
      <RiskBodyCard details={details} actionText={actionText} actionLink={actionLink}>
        {children}
      </RiskBodyCard>
    </section>
  );
}