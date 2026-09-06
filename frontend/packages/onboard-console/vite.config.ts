import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The newest release heading in CHANGELOG.md is the version. It used to be
// package.json's `version`, hand-bumped in every branch, which made one line
// the whole repo had to agree on before anything could merge: eight
// consecutive pull requests conflicted on it, and twice two branches picked the
// same number and git merged them silently because both sides wrote identical
// text.
//
// It is read from the markdown rather than from CHANGELOG_ENTRIES because the
// entries are now assembled with `import.meta.glob`, which vite rewrites when
// it transforms application code - not when esbuild bundles this config file.
// Importing them here would hand Node an `import.meta.glob` call that nothing
// has transformed. changelogData.test.ts asserts the markdown and the entries
// name the same newest release, so the two sources cannot drift apart.
const CHANGELOG = fileURLToPath(new URL("../../../CHANGELOG.md", import.meta.url));
const version = readFileSync(CHANGELOG, "utf-8").match(/^## \[(\d+(?:\.\d+)*)\]/m)?.[1];
if (!version) throw new Error(`No released version heading found in ${CHANGELOG}: the console has no version to display.`);

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
