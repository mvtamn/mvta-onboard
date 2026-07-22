import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The console is served under /console/* by Front Door, so the built assets
// must resolve from that base path.
export default defineConfig({
  base: "/console/",
  plugins: [react()],
  server: {
    port: 5174,
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
