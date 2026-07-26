export type RiskConfidence = "High" | "Medium" | "Low";
export type RiskTrend = "Worsening" | "Stable" | "Recovering";
export type RiskWorkflow = "New" | "Acknowledged" | "Monitoring" | "Alert prepared";

export interface DepartureTimelineStop {
  stop: string;
  scheduled: string;
  predicted: string;
  varianceMinutes: number;
  threshold?: boolean;
}

export interface FixedRouteRisk {
  id: string;
  tripId: string;
  route: string;
  direction: string;
  vehicle: string | null;
  currentDelayMinutes: number | null;
  predictedMaxMinutes: number | null;
  firstAffectedDeparture: string;
  firstAffectedTime: string;
  thresholdInMinutes: number | null;
  trend: RiskTrend;
  confidence: RiskConfidence;
  location: string;
  tripProgress: string;
  updatedSecondsAgo: number;
  reasons: string[];
  downstreamTrip: string | null;
  downstreamDelayMinutes: number | null;
  timeline: DepartureTimelineStop[];
}

export interface OnDemandRisk {
  id: string;
  tripNumber: string;
  zone: string;
  currentWaitMinutes: number;
  predictedWaitMinutes: number;
  predictedPickup: string;
  vehicle: string | null;
  stopsAhead: number | null;
  confidence: RiskConfidence;
  trend: RiskTrend;
  accessibleVehicleRequired: boolean;
  availableVehicles: number;
  nearestEligibleVehicle: string;
  reasons: string[];
}

export const FIXED_ROUTE_RISKS: FixedRouteRisk[] = [
  {
    id: "risk-442-nb",
    tripId: "442-1642-NB",
    route: "442",
    direction: "NB",
    vehicle: "1732",
    currentDelayMinutes: 9,
    predictedMaxMinutes: 18,
    firstAffectedDeparture: "Burnsville Transit Station",
    firstAffectedTime: "4:42 PM",
    thresholdInMinutes: 9,
    trend: "Worsening",
    confidence: "High",
    location: "Cedar Ave south of Burnsville Transit Station",
    tripProgress: "En route to next timepoint",
    updatedSecondsAgo: 28,
    reasons: [
      "Departure delay increased across three consecutive observations.",
      "Vehicle speed is below the recent norm for this segment.",
      "Only three minutes of scheduled recovery remain.",
      "TripUpdate and vehicle position feeds are current.",
    ],
    downstreamTrip: "Route 442 NB at 5:05 PM",
    downstreamDelayMinutes: 14,
    timeline: [
      { stop: "Cedar Grove Transit Station", scheduled: "4:21 PM", predicted: "4:30 PM", varianceMinutes: 9 },
      {
        stop: "Burnsville Transit Station",
        scheduled: "4:42 PM",
        predicted: "5:00 PM",
        varianceMinutes: 18,
        threshold: true,
      },
      { stop: "Apple Valley Transit Station", scheduled: "5:01 PM", predicted: "5:18 PM", varianceMinutes: 17 },
      { stop: "Route terminal", scheduled: "5:19 PM", predicted: "5:34 PM", varianceMinutes: 15 },
    ],
  },
  {
    id: "risk-477-eb",
    tripId: "477-1651-EB",
    route: "477",
    direction: "EB",
    vehicle: "1621",
    currentDelayMinutes: 13,
    predictedMaxMinutes: 16,
    firstAffectedDeparture: "Apple Valley Transit Station",
    firstAffectedTime: "5:07 PM",
    thresholdInMinutes: 14,
    trend: "Recovering",
    confidence: "Medium",
    location: "I-35W southbound near Cliff Road",
    tripProgress: "Approaching next timepoint",
    updatedSecondsAgo: 43,
    reasons: [
      "The trip remains above its normal segment travel time.",
      "Departure variance improved by two minutes in the latest observation.",
      "Vehicle position is current; downstream departure coverage is partial.",
    ],
    downstreamTrip: null,
    downstreamDelayMinutes: null,
    timeline: [
      { stop: "Downtown Minneapolis", scheduled: "4:31 PM", predicted: "4:44 PM", varianceMinutes: 13 },
      { stop: "Burnsville Transit Station", scheduled: "4:52 PM", predicted: "5:06 PM", varianceMinutes: 14 },
      {
        stop: "Apple Valley Transit Station",
        scheduled: "5:07 PM",
        predicted: "5:23 PM",
        varianceMinutes: 16,
        threshold: true,
      },
      { stop: "Route terminal", scheduled: "5:20 PM", predicted: "5:34 PM", varianceMinutes: 14 },
    ],
  },
  {
    id: "risk-495-sb",
    tripId: "495-1705-SB",
    route: "495",
    direction: "SB",
    vehicle: null,
    currentDelayMinutes: null,
    predictedMaxMinutes: null,
    firstAffectedDeparture: "Realtime data unavailable",
    firstAffectedTime: "—",
    thresholdInMinutes: null,
    trend: "Stable",
    confidence: "Low",
    location: "Last known near Mall of America",
    tripProgress: "Telemetry stale",
    updatedSecondsAgo: 386,
    reasons: [
      "No vehicle position has been received for more than six minutes.",
      "The trip has no current downstream departure prediction.",
      "A missing TripUpdate must not be interpreted as on-time service.",
    ],
    downstreamTrip: "Route 495 SB at 5:38 PM",
    downstreamDelayMinutes: null,
    timeline: [
      { stop: "Mall of America Transit Station", scheduled: "5:05 PM", predicted: "Unknown", varianceMinutes: 0 },
      { stop: "Burnsville Transit Station", scheduled: "5:31 PM", predicted: "Unknown", varianceMinutes: 0 },
      { stop: "Route terminal", scheduled: "5:52 PM", predicted: "Unknown", varianceMinutes: 0 },
    ],
  },
];

export const ON_DEMAND_RISKS: OnDemandRisk[] = [
  {
    id: "connect-1842",
    tripNumber: "1842",
    zone: "2",
    currentWaitMinutes: 19,
    predictedWaitMinutes: 31,
    predictedPickup: "4:27 PM",
    vehicle: null,
    stopsAhead: null,
    confidence: "High",
    trend: "Worsening",
    accessibleVehicleRequired: true,
    availableVehicles: 1,
    nearestEligibleVehicle: "12 minutes away",
    reasons: [
      "Trip remains unassigned.",
      "Current zone demand exceeds available accessible-vehicle capacity.",
      "The nearest eligible vehicle has one drop-off remaining.",
      "Predicted wait worsened by five minutes since the previous update.",
    ],
  },
  {
    id: "connect-1817",
    tripNumber: "1817",
    zone: "1",
    currentWaitMinutes: 23,
    predictedWaitMinutes: 28,
    predictedPickup: "4:19 PM",
    vehicle: "604",
    stopsAhead: 2,
    confidence: "Medium",
    trend: "Stable",
    accessibleVehicleRequired: false,
    availableVehicles: 3,
    nearestEligibleVehicle: "Assigned vehicle is 8 minutes away",
    reasons: [
      "Assigned vehicle has two service stops remaining.",
      "Recent dwell time is above the zone baseline.",
      "The prediction has remained stable across two updates.",
    ],
  },
  {
    id: "connect-1799",
    tripNumber: "1799",
    zone: "3",
    currentWaitMinutes: 27,
    predictedWaitMinutes: 29,
    predictedPickup: "4:14 PM",
    vehicle: "611",
    stopsAhead: 1,
    confidence: "High",
    trend: "Recovering",
    accessibleVehicleRequired: false,
    availableVehicles: 2,
    nearestEligibleVehicle: "Assigned vehicle is 4 minutes away",
    reasons: [
      "Actual wait has already exceeded the 25-minute service standard.",
      "Assigned vehicle is completing its final preceding drop-off.",
      "Pickup prediction improved by three minutes in the latest update.",
    ],
  },
  {
    id: "connect-1860",
    tripNumber: "1860",
    zone: "2",
    currentWaitMinutes: 17,
    predictedWaitMinutes: 24,
    predictedPickup: "4:33 PM",
    vehicle: "617",
    stopsAhead: 2,
    confidence: "Medium",
    trend: "Worsening",
    accessibleVehicleRequired: false,
    availableVehicles: 1,
    nearestEligibleVehicle: "Assigned vehicle is 10 minutes away",
    reasons: [
      "Predicted wait is inside the five-minute watch band.",
      "Zone demand is increasing.",
      "Assigned vehicle progress is current.",
    ],
  },
];
