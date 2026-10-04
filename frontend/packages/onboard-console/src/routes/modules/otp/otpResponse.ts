// GET /api/otp-monthly as the console reads it. Shared by the module and the
// Monthly Assessments page, so it lives beside both rather than in either.
import type { FlaggedStop, OtpMonthlyRouteRollup, OtpMonthMeasurement, OtpTargetSource } from "@mvta/shared";

export interface OtpMonthlyResponse {
  routes: OtpMonthlyRouteRollup[];
  /** Absent on a server older than 1.5.242; the console then shows the preview. */
  measurement?: OtpMonthMeasurement;
  /** Absent on a server older than 1.5.288; the queue is then empty, not wrong. */
  flagged?: FlaggedStop[];
  diagnostics: {
    configured: boolean;
    table_ready: boolean;
    service_month: string;
    record_count: number;
    routes_below_target: number;
    target: number;
    target_source?: OtpTargetSource;
    weather_days_recorded?: number;
  };
}
