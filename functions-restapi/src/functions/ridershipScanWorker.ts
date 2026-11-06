// The Count Sheet scan queue worker (plans/count-sheet-scan-upload.md §4,
// increment S1). One message splits an upload into page messages; each page
// message straightens and identifies one page.
//
// The REST app is a single B1 worker that was saturated in September, so
// pages are processed strictly one at a time in this process: the Service Bus
// trigger may hand over several messages at once, but each waits its turn
// here. A page takes a second or two, so a 150-page batch is a few minutes of
// one core rather than all of it at once. Redelivery is safe: a page or an
// upload already handled is skipped.
//
// After the last delivery (maxDeliveryCount 3, servicebus.bicep) a page that
// still fails is marked unreadable ("processing_failed") so a person sees it,
// and an upload that still fails is marked failed; neither stays pending.
import { app, type InvocationContext } from "@azure/functions";
import { getPool } from "../lib/db";
import { publishScanWork, RIDERSHIP_SCAN_QUEUE, type ScanWork } from "../lib/events";
import { giveUpOnPage, giveUpOnUpload, processPage, splitUpload } from "../lib/ridership/scan";

const MAX_DELIVERIES = 3;

let queue: Promise<unknown> = Promise.resolve();
/** Runs `work` after everything already queued in this process. */
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

function parse(message: unknown): ScanWork | null {
  const m = (typeof message === "string" ? JSON.parse(message) : message) as Partial<ScanWork> & Record<string, unknown>;
  if (m?.kind === "upload" && typeof m.upload_id === "string") return { kind: "upload", upload_id: m.upload_id };
  if (m?.kind === "page" && typeof m.page_id === "string") return { kind: "page", page_id: m.page_id };
  return null;
}

app.serviceBusQueue("ridershipScanWorker", {
  connection: "ServiceBusConnection",
  queueName: RIDERSHIP_SCAN_QUEUE,
  handler: async (message: unknown, context: InvocationContext) => {
    const work = parse(message);
    if (!work) {
      context.warn("Ignoring a malformed ridership scan message.");
      return;
    }
    const delivery = Number(context.triggerMetadata?.deliveryCount ?? 1);
    await oneAtATime(async () => {
      const pool = await getPool();
      try {
        if (work.kind === "upload") {
          const outcome = await splitUpload(pool, work.upload_id, (pageId) => publishScanWork({ kind: "page", page_id: pageId }, context));
          context.log(`Scan upload ${work.upload_id}: ${outcome}.`);
        } else {
          const outcome = await processPage(pool, work.page_id);
          context.log(`Scan page ${work.page_id}: ${outcome}.`);
        }
      } catch (err) {
        if (delivery < MAX_DELIVERIES) throw err;
        context.error(`Giving up on ${work.kind} after ${delivery} deliveries:`, err);
        if (work.kind === "upload") await giveUpOnUpload(pool, work.upload_id);
        else await giveUpOnPage(pool, work.page_id);
      }
    });
  },
});
