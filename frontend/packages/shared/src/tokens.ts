// MVTA brand design tokens, lifted from the approved look/feel in the original
// demo_service_alerts.html so the React apps match, not re-invent, the brand.
// Green + orange are MVTA's public identity; the ops console reuses the same
// palette with a more utilitarian layout.

export const color = {
  brandGreen: "#00553D",
  brandGreenMuted: "#639281",
  brandOrange: "#F78E1E",
  alertBarText: "#4A1B0C",

  pageBg: "#F3F2ED",
  surface: "#FFFFFF",
  border: "#E6E4DC",
  chipBg: "#F1EFE8",

  text: "#2C2C2A",
  textMuted: "#4F4F4F",
  textFaint: "#888888",

  danger: "#8A1F1F",
} as const;

// Category/severity badge colors (bg + fg), matching the demo page badges.
export const badge: Record<string, { bg: string; fg: string }> = {
  delay: { bg: "#FCEFD8", fg: "#7A4A00" },
  detour: { bg: "#FCEFD8", fg: "#7A4A00" },
  demand_response_delay: { bg: "#FCEFD8", fg: "#7A4A00" },
  outage: { bg: "#DCEAF8", fg: "#0B4C82" },
  closure: { bg: "#DCEAF8", fg: "#0B4C82" },
  general: { bg: "#E3F0D4", fg: "#33530F" },
  emergency: { bg: "#FBE0E0", fg: "#8A1F1F" },
  critical: { bg: "#FBE0E0", fg: "#8A1F1F" },
  major: { bg: "#FBE0E0", fg: "#8A1F1F" },
  minor: { bg: "#FCEFD8", fg: "#7A4A00" },
  informational: { bg: "#DCEAF8", fg: "#0B4C82" },
};
