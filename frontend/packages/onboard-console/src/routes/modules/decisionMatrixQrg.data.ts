// OCC Decision Matrix — QRG (Quick Reference Guide) grid data.
// This mirrors the printed field guide's own layout (numbered section ->
// named subsection -> Trouble/Probable Cause/Remedy/Reference rows), which is
// a different organization than MOCK_DATA's condition/criteria/action cards
// in decisionMatrix.data.ts - the same underlying guidance can appear in both
// views, organized for two different ways staff scan it.
// TODO: only Sections 6-7 have been transcribed so far; add the remaining
// sections here as the rest of the printed guide is digitized.
export interface QrgRow {
  trouble: string;
  cause: string;
  remedy: string;
  ref: string | null;
  refUrl: string;
}

export interface QrgSubsection {
  title: string;
  rows: QrgRow[];
}

export interface QrgSection {
  label: string;
  subsections: QrgSubsection[];
}

export const QRG_SECTIONS: QrgSection[] = [
  {
    label: "Section 6 | Communication Issues",
    subsections: [
      {
        title: "Radio & Voice",
        rows: [
          {
            trouble: "Radio communication issues",
            cause: "Radio system issue",
            remedy: "Create ticket and contact Connected Vehicles team",
            ref: "REF-6.1",
            refUrl: "#",
          },
          {
            trouble: "Unable to connect to buses in garage",
            cause: "Radio system issue",
            remedy: "Create ticket and contact Connected Vehicles team",
            ref: "REF-6.2",
            refUrl: "#",
          },
          {
            trouble: "Unable to hear both ways",
            cause: "Radio not switched on",
            remedy: "In garage: have shop address; on route: Ops to address",
            ref: "REF-6.3",
            refUrl: "#",
          },
          {
            trouble: "Voice fallback",
            cause: "Avail Fixed-End Server offline (maintenance window)",
            remedy: "Wait for communicated maintenance window to close",
            ref: "REF-6.4",
            refUrl: "#",
          },
          {
            trouble: "No sound on incoming radio alerts",
            cause: "C-Soft issue",
            remedy: "Submit Service Desk ticket",
            ref: "REF-6.5",
            refUrl: "#",
          },
        ],
      },
    ],
  },
  {
    label: "Section 7 | Vehicle & Emergency",
    subsections: [
      {
        title: "Onboard Incidents",
        rows: [
          {
            trouble: "Vehicle collision reported",
            cause: "Confirmed collision, injury, or blocked lane",
            remedy: "Dispatch to stop route; notify Emergency Response per SOP",
            ref: "SOP-7.1",
            refUrl: "#",
          },
          {
            trouble: "Onboard medical emergency",
            cause: "Passenger or operator shows signs of a medical event",
            remedy: "Advise operator to hold; dispatch EMS; log incident",
            ref: "SOP-7.2",
            refUrl: "#",
          },
          {
            trouble: "Vehicle door fault",
            cause: "Sensor fault or obstruction",
            remedy: "Instruct operator to cycle doors; ticket if unresolved",
            ref: "REF-7.3",
            refUrl: "#",
          },
        ],
      },
    ],
  },
];
