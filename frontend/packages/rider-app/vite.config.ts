import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During local dev, proxy /api to the live Front Door endpoint (or a local
// func host) so the browser makes same-origin calls and avoids CORS. In
// production the SWA sits behind Front Door with the API on the same origin.
export default defineConfig({
  plugins: [react()],
  // The rider app had no tests until the confirmation landing page, which is
  // six branches of copy and two forms that post to endpoints answering
  // deliberately uninformative results - the kind of thing that rots silently.
  // Same setup as the console's, so there is one way to test a component here.
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
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
