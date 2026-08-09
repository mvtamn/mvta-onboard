---
name: MVTA OnBoard
description: Calm, precise transit operations and rider communications
colors:
  mvta-evergreen: "#00553D"
  mvta-evergreen-deep: "#003D2C"
  signal-amber: "#F78E1E"
  warm-operations-canvas: "#F3F2ED"
  console-canvas: "#EDEBE4"
  surface: "#FFFFFF"
  surface-alt: "#F6F5F1"
  ink: "#2C2C2A"
  ink-muted: "#4F4F4F"
  ink-faint: "#888888"
  border: "#DDD"
  danger: "#8A1F1F"
  success: "#1F7A4C"
  information: "#0B4C82"
typography:
  headline:
    fontFamily: '-apple-system, "Segoe UI", Inter, Roboto, Arial, sans-serif'
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: 'Arial, Helvetica, sans-serif'
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: '-apple-system, "Segoe UI", Inter, Roboto, Arial, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: '-apple-system, "Segoe UI", Inter, Roboto, Arial, sans-serif'
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.07em"
rounded:
  compact: "4px"
  control: "6px"
  action: "8px"
  card: "10px"
  frame: "12px"
  shell: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  page: "24px"
components:
  button-primary:
    backgroundColor: "{colors.mvta-evergreen}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.action}"
    padding: "10px 18px"
  button-primary-rider:
    backgroundColor: "{colors.mvta-evergreen}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "12px 18px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.action}"
    padding: "8px 10px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px 18px"
  filter-chip:
    backgroundColor: "#F1EFE8"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "7px 14px"
---

# Design System: MVTA OnBoard

## Overview

**Creative North Star: "The Calm Control Room"**

MVTA OnBoard should feel like a well-run transit control room translated into software: calm under pressure, precise about state, and trustworthy enough for both operational decisions and public communication. The design is utilitarian without feeling crude. Information hierarchy, status language, and predictable controls carry the experience; playful decoration does not.

The staff console is compact and information-dense, using a persistent evergreen navigation rail, layered neutral work surfaces, small labels, and restrained semantic color. The rider app shares the same identity but opens the spacing, narrows the reading column, and simplifies the choices so urgent service information remains easy to understand.

**Key Characteristics:**

- MVTA Evergreen establishes identity and action.
- Warm neutral canvases reduce glare and separate work areas without visual noise.
- Compact typography and spacing support operational scanning.
- Semantic amber, red, blue, and green communicate state rather than decorate.
- Borders and tonal layers do most of the depth work; shadows are restrained.
- Light and dark console themes preserve the same hierarchy and brand logic.

## Colors

The palette combines civic evergreen with warm paper-like neutrals and a tightly controlled set of operational status colors.

### Primary

- **MVTA Evergreen** (#00553D): navigation, primary actions, panel headers, active controls, headings, route markers, and the strongest brand moments.
- **Deep Evergreen** (#003D2C): hover emphasis and the dark end of sign-in and branded gradients.

### Secondary

- **Signal Amber** (#F78E1E): high-visibility rider notices, highlighted operational attention, and fixed-route status accents. Use for signal value, not ambient decoration.

### Tertiary

- **Information Blue** (#0B4C82): informational states, selected delivery context, and non-alarm emphasis.
- **Success Green** (#1F7A4C): healthy, live, confirmed, or successful states distinct from the darker brand evergreen.
- **Operational Red** (#8A1F1F): errors, danger, critical conditions, and destructive hover states.

### Neutral

- **Warm Operations Canvas** (#F3F2ED): rider-page background and the warmest public-facing neutral.
- **Console Canvas** (#EDEBE4): light console environment around the application frame.
- **Surface White** (#FFFFFF): cards, fields, panels, and foreground reading surfaces.
- **Alternate Surface** (#F6F5F1): supporting bands, secondary panels, and quiet grouping.
- **Operations Ink** (#2C2C2A): primary text.
- **Muted Ink** (#4F4F4F): explanations and secondary data.
- **Faint Ink** (#888888): breadcrumbs, metadata, and low-priority context.
- **Working Border** (#DDD): ordinary separation; lighter and stronger neighboring border values may clarify density and state.

### Named Rules

**The Signal, Not Decoration Rule.** Saturated orange, red, blue, and success green communicate a real state or action. They are not used to make an otherwise quiet screen more playful.

**The Evergreen Anchor Rule.** Every major surface retains a clear MVTA Evergreen anchor through navigation, headings, primary action, or panel structure; do not scatter equal-strength accents across the same view.

## Typography

**Display Font:** System UI (`-apple-system`, Segoe UI, Inter, Roboto, Arial, sans-serif)
**Body Font:** System UI in the console; Arial with Helvetica fallback in the rider app
**Label/Mono Font:** System UI labels; `ui-monospace`, SF Mono, Menlo, Consolas for diagnostic data only

**Character:** Typography is familiar, compact, and neutral so riders and staff can read it quickly under varied conditions. Hierarchy comes from weight, size, restrained tracking, and placement rather than expressive typefaces.

### Hierarchy

- **Headline** (800, 22px, approximately 1.2): console page titles; compact but unmistakable.
- **Title** (700, 24px, approximately 1.2): rider-facing page titles in MVTA Evergreen.
- **Section Title** (700, 14.5–19px): panel headers, sign-in headings, and major module sections.
- **Body** (400, 13–14px, 1.4–1.5): instructions, alert content, form help, and operational descriptions.
- **Label** (700, 10.5–12px, up to 0.07em, often uppercase): navigation groups, table headers, field labels, status summaries, and metadata.

### Named Rules

**The Read-It-Once Rule.** Use direct labels, concise sentences, and visible state language. Type styling may establish priority but must never make operational or rider copy harder to parse.

## Layout

The console uses a centered application frame up to 1280px wide with a fixed 232px evergreen sidebar and a flexible content column. Main content typically uses 20–24px page padding, 20px layout gaps, flexible primary regions, and an optional 260px information rail. Repeated forms use compact 8–12px control padding and 10–18px gaps; operational stat collections use equal-width grids.

The rider app uses a centered 720px frame with 24px exterior padding and 24–32px content insets. It favors a single reading column, wrapping filter chips, and 12px-separated alert cards. Public content receives more breathing room than console data without becoming spacious or promotional.

Responsive layouts collapse multi-column form grids at 760px, operational module grids between roughly 600px and 1050px, and horizontal toolbars where necessary. Preserve essential actions and state; secondary toolbar actions may simplify before core information disappears.

The spacing rhythm is pragmatic rather than mathematical: 4px for micro-separation; 8–12px inside compact controls and groups; 14–18px inside cards; and 20–24px between major regions.

## Elevation & Depth

The system is flat and tonally layered by default. Canvas, surface, alternate-surface, border, and stripe values establish most hierarchy. Low ambient shadows reinforce major containers and workspaces; strong elevation is reserved for overlays or isolated sign-in surfaces.

### Shadow Vocabulary

- **Quiet Surface** (`0 1px 3px rgba(0, 0, 0, 0.04)`): small data and status cards.
- **Working Panel** (`0 2px 8px rgba(0, 0, 0, 0.04)`): panels, subcards, and recurring operational containers.
- **Application Frame** (`0 4px 16px rgba(0, 0, 0, 0.10)`): the console shell or a substantial workspace.
- **Elevated Sign-In** (`0 20px 50px rgba(0, 0, 0, 0.25)`): isolated authentication surface only.

### Named Rules

**The Flat-by-Default Rule.** Use tonal layers and borders before adding shadow. Shadow confirms hierarchy; it does not create atmosphere.

## Shapes

Corners are softly practical: 6–8px for controls, 9–12px for cards and workspaces, and 14px for the console shell. Four-pixel radii remain appropriate for dense tables and compact tools. Full pills are reserved for filters, compact statuses, user identity, and segmented controls. Circles are limited to avatars, live indicators, and icon-only toggles.

Borders are one pixel and quiet at rest, strengthening or changing color for focus, selection, error, and review state. Selected operational rows may use a 3–4px inset or left-edge signal rather than a larger shadow.

## Components

Components should feel compact, dependable, and unmistakably actionable.

### Buttons

- **Shape:** 6–8px radius for ordinary actions; pills only for special sign-in, filter, or segmented-control contexts.
- **Primary:** MVTA Evergreen with white text, bold 13–14px type, and approximately 10–12px vertical by 18px horizontal padding.
- **Hover / Focus:** deepen the evergreen, strengthen a border, or use the established evergreen focus ring; never rely on motion alone.
- **Secondary / Ghost:** white or current surface fill, working border, dark text, compact padding; hover shifts border and text toward evergreen.
- **Disabled:** lower opacity and remove the active cursor while keeping the label readable.

### Chips

- **Style:** quiet warm-neutral fill for filters; semantic tinted fills for status; 10.5–13px bold or medium text; pill geometry.
- **State:** selected filters become MVTA Evergreen with white text. Semantic chips preserve their assigned warning, danger, information, success, or muted role.

### Cards / Containers

- **Corner Style:** 10–12px for common cards and workspaces.
- **Background:** surface white or the theme's surface token.
- **Shadow Strategy:** flat by default, with Quiet Surface or Working Panel shadow where grouping needs reinforcement.
- **Border:** one-pixel working or soft border.
- **Internal Padding:** usually 14–18px; rider cards use 16px 18px.

### Inputs / Fields

- **Style:** surface background, one-pixel border, 6–8px radius, 8–12px padding, and inherited UI typography.
- **Focus:** evergreen border with a restrained `0 0 0 3px rgba(0, 85, 61, 0.15)` ring where the module defines one.
- **Error / Disabled:** operational red for error text and borders; disabled controls remain legible and visibly inactive.

### Navigation

The console navigation is a persistent evergreen sidebar with white or translucent text, 6px-rounded items, 9px 12px padding, compact icons, and a slightly lighter translucent active fill. Section labels are small uppercase text with widened tracking. The rider navigation is a simple horizontal header with dark links and evergreen active state; it must wrap or simplify cleanly on narrow screens.

### Operational Panels and Tables

Panel headers use MVTA Evergreen with white text; their bodies continue as bordered surfaces with matched lower corners. Data tables use evergreen uppercase headers, compact cells, soft row separators, and restrained zebra striping. Status, review, and live-data distinctions must remain visible without depending on color alone.

## Do's and Don'ts

### Do:

- **Do** use MVTA Evergreen as the stable identity and primary-action anchor.
- **Do** use warm neutral canvases, surface layers, borders, and compact spacing to organize dense information.
- **Do** reserve semantic colors for meaningful operational and rider states.
- **Do** state whether data is live, preview, sample, offline, pending, or unavailable.
- **Do** preserve visible focus, keyboard usability, sufficient contrast, and plain rider-facing language.
- **Do** give the public rider app enough space and clarity even when the console remains dense.

### Don't:

- **Don't** add playful decoration, novelty illustration, or ornamental motion to operational or rider-critical surfaces.
- **Don't** use status colors as interchangeable decoration or create competing accents of equal visual weight.
- **Don't** turn routine cards into floating tiles with heavy shadows.
- **Don't** hide consequential state in hover-only interactions, color alone, or ambiguous icons.
- **Don't** import consumer-tech gloss, oversized marketing typography, glass effects, or gratuitous gradients into the incumbent system.
- **Don't** imply that preview, sample, or incomplete workflows are live or production-ready.
