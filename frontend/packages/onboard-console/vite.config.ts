import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served behind Front Door at /console/* (confirmed live: route-onboard's
// rsConsoleV2 rule set strips the /console prefix via UrlRewrite before
// forwarding to this SWA's origin, which serves plain /assets/*). Because the
// rewrite happens server-side at the edge, the BROWSER-facing asset URLs must
// stay /console/assets/* so Front Door's own route pattern matches them - this
// base is what's actually correct for production. Direct access to the bare
// SWA hostname (bypassing Front Door) is NOT a supported path and will 404 on
// assets; always test via the Front Door endpoint.
export default defineConfig({
  base: "/console/",
  plugins: [react()],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5174,
    proxy: {
      "/api": {
        // Default to the live dev Front Door so previews show real data from
        // the public read endpoints. Set VITE_API_PROXY_TARGET to
        // http://localhost:7071 to hit a local `func start` instead.
        target:
          process.env.VITE_API_PROXY_TARGET ||
          "https://endpoint-mvta-onboard-dev-haehgsbbe6esd8cc.z03.azurefd.net",
        changeOrigin: true,
      },
    },
  },
});
