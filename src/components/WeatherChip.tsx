// src/components/WeatherChip.tsx
import { Chip } from "@mui/material";
import { useMemo } from "react";

function emojiFromText(text: string) {
  const t = text.toLowerCase();
  if (t.includes("thunder")) return "⛈️";
  if (t.includes("rain") || t.includes("shower") || t.includes("drizzle")) return "🌧️";
  if (t.includes("snow")) return "❄️";
  if (t.includes("fog") || t.includes("mist")) return "🌫️";
  if (t.includes("overcast")) return "☁️";
  if (t.includes("cloud")) return "⛅️";
  if (t.includes("clear") || t.includes("sun")) return "☀️";
  return "🌤️";
}

export default function WeatherChip({ text }: { text: string }) {
  const label = useMemo(() => `${emojiFromText(text)} ${text}`, [text]);
  return (
    <Chip
      size="small"
      label={label}
      sx={{
        fontSize: 12,
        ".MuiChip-label": { display: "flex", alignItems: "center", gap: "6px" },
        "@keyframes bob": { "0%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-2px)" }, "100%": { transform: "translateY(0)" } },
        "& .MuiChip-label::first-letter": { animation: "bob 2.4s ease-in-out infinite", display: "inline-block" }
      }}
      variant="outlined"
    />
  );
}
