// HTTP for a refused Detour workflow act. The module stays free of HTTP; the
// handlers share this one mapping.
import type { HttpResponseInit } from "@azure/functions";
import type { Refusal } from "./detourWorkflow";

export function refusalResponse(refusal: Refusal): HttpResponseInit {
  return {
    status: refusal.code === "not_found" ? 404 : 409,
    jsonBody: { error: refusal.sentence, code: refusal.code, ...(refusal.conflicts ? { conflicts: refusal.conflicts } : {}) },
  };
}
