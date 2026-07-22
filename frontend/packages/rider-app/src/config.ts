import { createApiClient } from "@mvta/shared";

// Empty base = same-origin (production, behind Front Door). A value is only
// needed for cross-origin dev/testing.
const baseUrl = import.meta.env.VITE_API_BASE ?? "";

export const api = createApiClient({ baseUrl });
