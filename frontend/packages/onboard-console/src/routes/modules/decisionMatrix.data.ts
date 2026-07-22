// OCC Decision Matrix reference data.
// TODO: replace MOCK_DATA with `fetch('/api/occ/decision-matrix')` — that
// endpoint reads SharePoint document-library metadata (Condition, Criteria,
// RequiredAction, Severity, DocType, DocCode, Tags, LastReviewed) via Graph.
export type Severity = "stop" | "restricting" | "clear";
export type DocType = "SOP" | "REF";

export interface MatrixEntry {
  id: string;
  condition: string;
  severity: Severity;
  tags: string[];
  criteria: string;
  requiredAction: string;
  docType: DocType;
  docCode: string;
  docUrl: string;
  lastReviewed: string;
}

export const SEV_LABEL: Record<Severity, string> = {
  stop: "Stop",
  restricting: "Restricting",
  clear: "Clear",
};

export const MOCK_DATA: MatrixEntry[] = [
  { id: "occ-01", condition: "Vehicle Collision", severity: "stop", tags: ["Safety", "Emergency Response"], criteria: "Any collision involving passenger or bystander injury, a second vehicle, or a blocked travel lane.", requiredAction: "Notify command staff immediately, dispatch EMS/police per protocol, hold vehicle in place until cleared.", docType: "SOP", docCode: "SOP-OCC-001-00", docUrl: "https://mvtamn.sharepoint.com/sites/Operations/_SOPs/_OCC%20Documents/SOP_OCC-001-00_Vehicle_Collision.docx", lastReviewed: "2026-05-12" },
  { id: "occ-02", condition: "Onboard Medical Emergency", severity: "stop", tags: ["Medical", "Emergency Response"], criteria: "Passenger or operator shows signs of a medical event (loss of consciousness, chest pain, seizure, severe allergic reaction).", requiredAction: "Confirm EMS dispatch, hold vehicle location, keep line open with operator until responders arrive on scene.", docType: "SOP", docCode: "SOP-OCC-002-00", docUrl: "https://mvtamn.sharepoint.com/sites/Operations/_SOPs/_OCC%20Documents/SOP_OCC-002-00_Medical_Emergency.docx", lastReviewed: "2026-04-28" },
  { id: "occ-03", condition: "Suspicious Package / Bomb Threat", severity: "stop", tags: ["Security", "Emergency Response"], criteria: "Unattended or suspicious item reported onboard or at a facility, or a direct threat received by phone/radio.", requiredAction: "Do not approach or handle the item. Evacuate per protocol, notify law enforcement and command staff immediately.", docType: "SOP", docCode: "SOP-OCC-003-00", docUrl: "https://mvtamn.sharepoint.com/sites/Operations/_SOPs/_OCC%20Documents/SOP_OCC-003-00_Suspicious_Package.docx", lastReviewed: "2026-03-02" },
  { id: "occ-04", condition: "Passenger Assault / Threat to Operator", severity: "restricting", tags: ["Security", "Passenger Conduct"], criteria: "Verbal threat, physical altercation, or aggressive behavior directed at the operator or another passenger.", requiredAction: "Assess operator safety, request law enforcement response if ongoing, document per the conduct reference.", docType: "REF", docCode: "REF-2026-011", docUrl: "https://mvtamn.sharepoint.com/sites/Operations/_SOPs/_OCC%20Documents/REF_REF-2026-011_Operator_Threat_Response.docx", lastReviewed: "2026-06-01" },
  { id: "occ-05", condition: "Severe Weather Detour", severity: "restricting", tags: ["Weather"], criteria: "Route impacted by flooding, ice, or a high-wind advisory affecting safe vehicle operation.", requiredAction: "Supervisor confirms detour routing before it is broadcast to operators; log affected trips.", docType: "REF", docCode: "REF-2026-012", docUrl: "https://mvtamn.sharepoint.com/sites/Operations/_SOPs/_OCC%20Documents/REF_REF-2026-012_Severe_Weather_Detour.docx", lastReviewed: "2026-01-15" },
  { id: "occ-06", condition: "Mechanical Breakdown — In Service", severity: "restricting", tags: ["Mechanical"], criteria: "Vehicle disabled on route and unable to continue safely under its own power.", requiredAction: "Arrange bridge vehicle, notify affected stops if delay exceeds threshold, confirm passengers are secure.", docType: "SOP", docCode: "SOP-OCC-004-00", docUrl: "https://mvtamn.sharepoint.com/sites/Operations/_SOPs/_OCC%20Documents/SOP_OCC-004-00_Mechanical_Breakdown.docx", lastReviewed: "2026-05-30" },
  { id: "occ-07", condition: "Lost or Vulnerable Passenger", severity: "restricting", tags: ["Safety", "Passenger Conduct"], criteria: "Unaccompanied minor or vulnerable adult unable to reach their intended destination contact.", requiredAction: "Hold vehicle, loop in supervisor, do not release passenger until a verified contact or authority takes custody.", docType: "REF", docCode: "REF-2026-013", docUrl: "https://mvtamn.sharepoint.com/sites/Operations/_SOPs/_OCC%20Documents/REF_REF-2026-013_Vulnerable_Passenger.docx", lastReviewed: "2026-02-19" },
  { id: "occ-08", condition: "Standard Service Delay", severity: "clear", tags: ["Mechanical", "Weather"], criteria: "Delay from routine traffic or congestion with no safety concern and no missed connections.", requiredAction: "Operator logs delay per standard procedure; no OCC escalation required.", docType: "REF", docCode: "REF-2026-014", docUrl: "https://mvtamn.sharepoint.com/sites/Operations/_SOPs/_OCC%20Documents/REF_REF-2026-014_Standard_Delay.docx", lastReviewed: "2026-06-10" },
  { id: "occ-09", condition: "Fare Dispute", severity: "clear", tags: ["Passenger Conduct"], criteria: "Routine disagreement over fare or transfer validity with no safety concern.", requiredAction: "Operator handles per standard customer service reference; no dispatch action needed.", docType: "REF", docCode: "REF-2026-015", docUrl: "https://mvtamn.sharepoint.com/sites/Operations/_SOPs/_OCC%20Documents/REF_REF-2026-015_Fare_Dispute.docx", lastReviewed: "2026-03-22" },
  { id: "occ-10", condition: "Scheduled Detour Notification", severity: "clear", tags: ["Weather", "Mechanical"], criteria: "Planned construction or event detour already on file with an approved routing packet.", requiredAction: "Confirm operators received the routing packet before shift start; no further action unless conditions change.", docType: "REF", docCode: "REF-2026-016", docUrl: "https://mvtamn.sharepoint.com/sites/Operations/_SOPs/_OCC%20Documents/REF_REF-2026-016_Scheduled_Detour.docx", lastReviewed: "2026-06-18" },
];
