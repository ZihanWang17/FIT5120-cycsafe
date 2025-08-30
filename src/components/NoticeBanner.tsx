// src/components/NoticeBanner.tsx
import { Box, IconButton, Typography } from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";

export default function NoticeBanner({ text, onClose }: { text: string; onClose?: () => void }) {
  return (
    <Box
      className="notice-banner"
      sx={{
        width: "100%",
        maxWidth: "100%",
        bgcolor: "rgba(59,130,246,0.08)",
        border: "1px solid rgba(59,130,246,0.30)",
        color: "rgb(29,78,216)",
        borderRadius: 2,
        px: 1.5,
        py: 1,
        display: "flex",
        alignItems: "flex-start",
        gap: 1,
        overflow: "hidden",
      }}
    >
      <Box sx={{ fontSize: 18, lineHeight: 1, mt: "1px", flex: "0 0 auto" }}>🔔</Box>
      <Typography
        variant="body2"
        sx={{
          lineHeight: 1.4,
          flex: 1,
          wordBreak: "break-word",
          overflowWrap: "anywhere",
          hyphens: "auto",
          minWidth: 0,
        }}
      >
        {text}
      </Typography>
      {onClose && (
        <IconButton size="small" onClick={onClose} sx={{ ml: 0.5, flex: "0 0 auto" }}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      )}
    </Box>
  );
}