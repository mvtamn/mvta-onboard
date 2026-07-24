// Wraps the Vite build output (dist/) into dist-wrapped/, nesting everything
// under a literal console/ subfolder so the physical files on disk match the
// /console/assets/* URLs the app requests (base: "/console/" in vite.config.ts).
//
// Why this exists: this app is served behind Front Door at /console/*. Front
// Door forwards requests to this SWA's origin WITHOUT stripping the /console
// prefix - a Front Door rule (rsConsoleV2/StripConsole) was built to strip it
// server-side, but empirically never took effect on live traffic despite
// Azure's control plane reporting it as successfully configured (confirmed via
// a diagnostic response-header test: the rule set was never invoked for asset
// paths). Rather than depend on that unreliable mechanism, this script makes
// the deployed file layout match the requested URLs directly, so no rewrite
// is needed at all - just plain, provably-working path forwarding.
//
// SWA's deploy validator requires an index.html at the deployment ROOT, so a
// copy is placed there too (harmless; real traffic through Front Door only
// ever requests /console/*, confirmed by inspecting live route behavior).
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(pkgDir, "dist");
const wrappedDir = join(pkgDir, "dist-wrapped");

if (!existsSync(distDir)) {
  console.error("dist/ not found - run the build before wrap-dist.");
  process.exit(1);
}

rmSync(wrappedDir, { recursive: true, force: true });
mkdirSync(join(wrappedDir, "console"), { recursive: true });

cpSync(distDir, join(wrappedDir, "console"), { recursive: true });

// staticwebapp.config.json must live at the deployment root, not nested.
const configName = "staticwebapp.config.json";
const nestedConfig = join(wrappedDir, "console", configName);
if (existsSync(nestedConfig)) {
  cpSync(nestedConfig, join(wrappedDir, configName));
  rmSync(nestedConfig);
}

// Root-level index.html copy to satisfy SWA's "must have a default file at
// the app artifacts folder root" deployment check. Never actually served in
// production (Front Door only ever requests /console/*), but keeps `swa
// deploy` from rejecting the upload.
cpSync(join(wrappedDir, "console", "index.html"), join(wrappedDir, "index.html"));

console.log(`Wrapped build output into ${wrappedDir} (console/* + root index.html + root config)`);
