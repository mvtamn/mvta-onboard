// Entry point for the Spare webhook receiver's own Function App
// (func-mvta-sparehook-<env>). It loads the receiver and a health check and
// nothing else.
//
// The receiver shared a small plan with every poller the REST API runs. Spare
// delivers roughly a webhook a second and bursts far higher - 563 in one minute
// on 2026-09-09 - and during those bursts the plan sat at 95-100% CPU while the
// feed pollers slowed twenty- to a hundred-fold. The intake gate (#175) already
// bounds the receiver's database work; what it cannot bound is the cost of
// accepting that many requests on the same worker as the pollers. So the
// receiver runs on its own plan.
//
// It must never be deployed with the REST app's `main` glob
// (dist/src/functions/*.js): that would register every timer on a second app
// and double every poller. The deploy leg rewrites `main` to this file and
// fails if anything other than these two functions registers
// (scripts/registered-functions.cjs, and functions/spareWebhookEntry.test.ts).
import "./functions/health";
import "./functions/onDemandSpareWebhook";
