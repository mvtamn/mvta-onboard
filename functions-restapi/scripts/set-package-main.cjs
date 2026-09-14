#!/usr/bin/env node
// Points a deploy workspace's package.json `main` at one entry file. Run only
// on the CI runner's copy, just before packaging the Spare webhook receiver's
// app; the committed package.json keeps the REST API's functions/*.js glob.
//
//   node scripts/set-package-main.cjs <dir> <main>
"use strict";
const fs = require("fs");
const path = require("path");

const [dirArgument, main] = process.argv.slice(2);
if (!dirArgument || !main) {
  console.error("usage: set-package-main.cjs <dir> <main>");
  process.exit(2);
}
const dir = path.resolve(dirArgument);
if (!fs.existsSync(path.join(dir, main))) {
  console.error(`${main} does not exist in ${dir} - build before packaging`);
  process.exit(2);
}
const file = path.join(dir, "package.json");
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
pkg.main = main;
fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`package.json main -> ${main}`);
