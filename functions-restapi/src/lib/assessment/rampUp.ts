export type RampUpStage = "suspended" | "half" | "full";

function parseMonth(value: string): number {
  if (!/^\d{6}$/.test(value)) throw new Error("serviceMonth must be YYYYMM");
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  if (month < 1 || month > 12) throw new Error("serviceMonth must be YYYYMM");
  return year * 12 + month - 1;
}

export function rampUpStage(contractStartDate: string, serviceMonth: string): RampUpStage {
  if (!/^\d{8}$/.test(contractStartDate)) throw new Error("contractStartDate must be YYYYMMDD");
  const startMonth = parseMonth(contractStartDate.slice(0, 6));
  const assessedMonth = parseMonth(serviceMonth);
  const ordinal = assessedMonth - startMonth + 1;
  if (ordinal < 1) throw new Error("serviceMonth precedes the contract start month");
  if (ordinal <= 3) return "suspended";
  if (ordinal <= 6) return "half";
  return "full";
}

export function rampUpMultiplier(stage: RampUpStage, isSafetyCritical: boolean): number {
  if (isSafetyCritical) return 1;
  if (stage === "suspended") return 0;
  if (stage === "half") return 0.5;
  return 1;
}
