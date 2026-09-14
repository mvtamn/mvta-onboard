#!/usr/bin/env node
// Lists, by name, the Azure Functions an entry point registers - without
// starting a Functions host. `@azure/functions` is swapped for a recorder, the
// entry is required, and every app.<trigger>(name, ...) call is collected.
//
// Used to prove the Spare webhook receiver's app loads only what it should: a
// package whose `main` picked up the REST API's functions would register every
// timer a second time and double every poller.
//
//   node scripts/registered-functions.cjs --entry dist/src/spareWebhookEntry.js
//   node scripts/registered-functions.cjs --package .   (package.json main; must name one file)
"use strict";
const Module = require("module");
const path = require("path");

const TRIGGERS = new Set([
  "http", "get", "post", "put", "patch", "deleteRequest", "timer", "storageBlob", "storageQueue",
  "serviceBusQueue", "serviceBusTopic", "eventHub", "eventGrid", "cosmosDB", "warmup", "sql", "mySql",
  "webPubSub", "generic",
]);
const registered = [];
const app = new Proxy({}, {
  get(_target, key) {
    return (name) => {
      if (TRIGGERS.has(String(key))) registered.push(String(name));
    };
  },
});
const inert = new Proxy(function inert() {}, { get: () => inert, apply: () => inert });
const functionsModule = new Proxy({}, {
  get(_target, key) {
    if (key === "app") return app;
    if (key === "__esModule") return false;
    return inert;
  },
});

const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === "@azure/functions") return functionsModule;
  return originalLoad.call(this, request, ...rest);
};

function argument(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

let entry = argument("--entry");
const packageDir = argument("--package");
if (!entry && packageDir) {
  const dir = path.resolve(packageDir);
  const main = require(path.join(dir, "package.json")).main;
  if (!main || /[*?[\]{}]/.test(main)) {
    console.error(`package.json main must name a single entry file, not "${main}"`);
    process.exit(2);
  }
  entry = path.join(dir, main);
}
if (!entry) {
  console.error("usage: registered-functions.cjs --entry <file> | --package <dir>");
  process.exit(2);
}

require(path.resolve(entry));
// Last line of output, and exit at once: modules loaded by the entry may hold
// timers or pools open, and this only needed their registrations.
console.log(JSON.stringify([...new Set(registered)].sort()));
process.exit(0);
