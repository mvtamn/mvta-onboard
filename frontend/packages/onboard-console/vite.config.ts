import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { CHANGELOG_ENTRIES } from "./src/routes/changelogData.js";

// The newest changelog entry IS the version. It used to be package.json's
// `version`, hand-bumped in every branch, which made one line the whole repo
// had to agree on before anything could merge: eight consecutive pull requests
// conflicted on it, and twice two branches picked the same number and git
// merged them silently because both sides wrote identical text. Reading it
// from the changelog removes the second copy, so there is nothing left to
// drift, and the number now lives in the file that already had to be edited to
// describe the release. package.json's version field is no longer the product
// version - see changelogData.test.ts, which fails on a duplicate or
// out-of-order version rather than letting one through. Two branches can still
// pick the same next number, since both read the same main; that now fails CI
// instead of merging quietly.
const version = CHANGELOG_ENTRIES[0]?.version;
if (!version) throw new Error("CHANGELOG_ENTRIES is empty: the console has no version to display.");

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
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react()],
  server: {
    // The repo root sits one level above this workspace, so vite's default
    // file allowlist stops short of CHANGELOG.md. changelogData.test.ts reads
    // it to check the two changelogs still agree on the newest release, which
    // is now also the build version.
    fs: { allow: [fileURLToPath(new URL("../../../", import.meta.url))] },
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
  // No globals: tests import describe/it/expect/vi explicitly from "vitest"
  // rather than relying on injected globals, so no tsconfig "types" changes
  // are needed just to make test files compile.
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
  },
});
