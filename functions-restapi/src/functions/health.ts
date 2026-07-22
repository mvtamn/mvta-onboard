// GET /api/health - required by the Front Door health probe.
import { app } from "@azure/functions";

app.http("health", {
  route: "health",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async () => {
    return { status: 200, jsonBody: { status: "healthy" } };
  },
});
