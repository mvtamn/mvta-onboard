# Count Sheet scan upload and handwriting reading — evaluation

Date: 2026-11-02. **Not implemented; nothing here is decided.** This is an
evaluation with a recommendation for each question, written for the user to
decide on.

It builds on spec §15, "the Count Sheet's journey: QR link, submission, scan
and reading" (`plans/ridership-counting-spec.md`, PR #455). §15 already
settles the following, and this document does not reopen them:

- the QR code is a link;
- the paper is always handed in;
- a reading is only ever a *proposal*;
- the contractor's operations management scans;
- scans are kept under a locked retention policy.

This document answers the questions §15 left open (how handwriting is read,
the upload route, personal data) and adds what building it would take.

Kiosk and web submission, and operator PIN sign-in, are out of scope. They
are covered elsewhere. The schema below leaves room for §15's comparison of
scan with submission, but does not design it.

## Summary

| Question | Recommendation |
|---|---|
| Capture | An **upload page in the console**. It takes a batch PDF from the garage multifunction printer (MFP). A single photo is the fallback. The **garage check-in desk** uploads once per shift. A watched folder or scan-to-email comes later, and only if the desk finds uploading a burden. |
| Identifying the page | Straighten the page on its **four corner marks**, then decode the **QR code at its known position**. If that fails, read the large printed BLOCK and date. If that fails too, a person types the block. The printed footer time identifies the print run. Blank backs are dropped, duplicates are kept and marked, and missing sheets are listed. |
| Reading | **Azure AI Document Intelligence (Read, or Layout if needed), with no training**, run on a page whose printed box lines have been removed. OnBoard's own geometry maps each word to its box. OnBoard measures ink itself to detect ticks and empty boxes. The operator's name is **masked before the image leaves OnBoard**. A custom model or an in-house digit classifier is used only if the trial shows the off-the-shelf reader falls short. Azure OpenAI vision is not used as the reader. |
| Into OnBoard | Readings land as proposals with a confidence score, on the existing sheet form, with the scan beside the trips. Low-confidence boxes stay **empty, with the reading shown as a hint**, so OCC has to type them. `entered_at` remains the time a person confirms the sheet, **not** the upload time. |
| Storage | A dedicated private storage account. The original upload goes in a **WORM (write-once) container**, whose time-based policy stays unlocked until records management sets the period, and is locked after that. Images are opened only by the §10 operator-name roles, and every open is logged. |
| Phasing | Nothing changes before Dec 1. A **capture-only pilot at Burnsville** (about 20 sheets a weekday) can start in mid-December. It produces the labelled set for the reading trial, because OCC keys every December sheet anyway. Proposed values arrive at the pilot garage after the January close, and at every garage after that. |
| Cost | About **$5–40 a month** in Azure at about 3,500 pages a month (Document Intelligence Read or Layout, plus storage). About $110 a month if a custom model is needed. Engineering time and desk time are the real costs. |

## What the sheet already gives us (main at 1.7.10)

`functions-restapi/src/lib/ridership/countSheetPdf.ts` was designed to be read
by machine (spec §3). Every feature that matters is already printed:

- **Four solid 12 pt corner marks**, inset 18 pt.
- A **QR code** at the top right, 25–30 mm, error correction Q. It holds
  `…/r/<YYYYMMDD>/<block>`, plus `?p=2` on a continuation page.
- The **block in 34 pt type** and the **date in 13 pt type**, as a fallback
  for the QR code.
- **Three 16×18 pt digit boxes per trip**, and an **11 pt DNO (did not
  operate) tick box**, at fixed coordinates. The layout constants are
  `RULE_Y`, `DIGIT` and `TRIP_ROW`, with each trip row 26 pt tall.
- **Five operator-ID boxes, four bus boxes and an initials box.**
- **Three unscheduled rows**: route (3 boxes), HH:MM (4 boxes), AM/PM,
  N S E W, Tripper/Extra/OCC ticks, and a total (3 boxes).
- A **Reconstructed** tick box.
- The trip's **printed name** ("320-E"), and a **footer print time**
  ("Printed 2026-12-12 9:10 PM CT").
- Black on white, with no fills behind text.

Two facts from dev's Dispatch Log (Oct 5 – Nov 1) shape the volume:

- A weekday has **144 sheets**. A Saturday and a Sunday each have **36**.
- No block has more than **12 trips**, so no sheet needs a second page today.
  That makes about **3,450 pages a month**. Allow 3,500 for rescans.

Blank backs (the print option) are extra pages in a duplex scan. The reader
drops them, and they are not billed if they are dropped before reading.

## Feasibility check (synthetic, 2026-11-02)

**Method.** No real scan was used. The sheet was rendered with the real
`countSheetPdf.ts` for a made-up block 024, 11 trips and a "Sample" garage.
The boxes were filled by script, in five handwriting-style system fonts, with
random size and position jitter. The values were written both zero-padded
(`027`) and right-aligned (` 27`). Some trips had a DNO tick drawn across the
box edge.

Four scans were then simulated: 300, 200 and 150 dpi, tilted −1.5° to 4°,
with blur and noise; and a phone photo with perspective and uneven lighting.
The pipeline, in OpenCV, was:

1. find the corner marks;
2. warp to the page's true geometry;
3. decode the QR code;
4. cut out every total box and DNO box at the coordinates in
   `countSheetPdf.ts`;
5. measure ink.

The script is kept outside the repo, in the session notes folder, so that no
scan tooling lands before it is decided.

| Simulated capture | Corner marks → straightened | Residual error | QR code decoded | Trip status (count / DNO) | Which boxes hold a digit |
|---|---|---|---|---|---|
| MFP, 300 dpi, 2.3° | yes | 0.2 px | full page: no; **known-position crop after straightening: yes** | 11/11 | 11/11 |
| MFP, 200 dpi, −1.5° | yes | 0.3 px | yes | 11/11 | 11/11 |
| MFP, 150 dpi, 4° | yes | 0.4 px | full page: no; **crop: yes** | 11/11 | 11/11 |
| Phone, perspective, one corner cropped off | **no** | — | no | — | — |

What this shows:

- **For MFP scans, the geometry problem is solved by the sheet as printed.**
  Once the four marks are found, every box lands within half a pixel. Tick
  detection and empty-box detection need no AI at all.
- **Decode the QR code after straightening, at its known position.** A
  full-page decode failed on two of the three MFP scans. A crop of the known
  position decoded on all three. (These tests used OpenCV's decoder. ZXing is
  more tolerant and is worth using in production.)
- **The mark finder has to know a mark's expected size.** The QR code's
  finder patterns are also solid squares, in the top-right corner. The first
  version of the script picked them up by mistake.
- **A phone photo that cuts off a corner mark cannot be straightened.** The
  phone capture screen needs a framing guide, and should refuse a photo
  unless all four marks are in it.
- **Digit reading was not tested.** Synthetic fonts say nothing about
  operators' handwriting on a moving bus. That is what the December trial is
  for (Phasing).

## 1. Capture

| Option | For | Against |
|---|---|---|
| **Console upload page** (batch PDF, or one image) | Works with any MFP that can scan to a PC, to USB or to the user's own email. Uses the existing Entra B2B sign-in and roles. The uploader sees at once which pages were recognised and fixes the rest while the paper is still in hand. Follows the user-delegation SAS pattern in `lib/blobStorage.ts` (detour images). | One more manual step for the desk: scan, then upload. |
| MFP **scan-to-email** to a shared mailbox | One button on the MFP. | Needs a Graph mail subscription and `Mail.Read` admin consent (Graph consent is already a blocker on prod, AADSTS65001). Attachment size limits. Failures are silent: nobody sees "page 7 unreadable" at the desk. |
| MFP **scan-to-folder** (SharePoint, or an SMB share that is synced) | One button. A SharePoint folder could reuse the Sites.Selected grant and the SOP folder walker. | Depends on the MFP model's connectors (unknown). Feedback is delayed. A folder of operator names in SharePoint needs its own access control. |
| **Phone camera** | No MFP needed. Good for a single late or reconstructed sheet. | Perspective, glare and cropped marks (see the feasibility check). OPR-038's device rule applies to operators, not to the desk, but the desk would still need an MVTA device. Slow for 144 sheets. |

**Batch or one page at a time.** Batch. One PDF per scan run, split by
OnBoard. Single pages are for late sheets, and the phone. The upload page
takes both: several files, PDF/TIFF/JPEG/PNG, up to about 50 pages per file.

**Who uploads.** The **garage check-in desk**, which already holds the
Ridership Printer role (migration 159). It receives the paper at pull-in, so
it can scan once at the end of each shift and fix unreadable pages with the
paper in hand. OCC can also upload, as a fallback, for paper that reaches
OCC.

- This needs a new action, **`ridership.scan`**, added to `ridership-printer`,
  `ridership-recorder` and `ridership-manager`.
- The upload result shows the desk each page's outcome (block, date,
  recognised / blank / duplicate / unreadable), with **no image**. An
  unreadable page is identified by its page number in the file, and the desk
  types its block and date from the paper. The desk never browses the
  archive.

**Recommendation:** the upload page first. Revisit scan-to-folder after the
pilot, if the desk finds uploading a burden and the MFPs can send to
SharePoint.

## 2. Identifying the page

The order, per page:

1. **Drop blank backs.** A page with almost no ink, or with "This side
   intentionally blank" on it, is dropped. It is never billed and never shown.
2. **Straighten on the corner marks.** Find the four marks, using the
   expected size, and fit the transform: affine is enough for an MFP scan,
   perspective is needed for a photo. Check the result by finding the marks
   again. If a mark is missing, the page is **unreadable**, and the photo
   flow asks for a retake.
3. **Decode the QR code at its known position.** If that fails, decode the
   whole page. If that fails too, read the printed **BLOCK** and **date**
   (their text comes back from Document Intelligence anyway). If even that
   fails, a person assigns the page.
   - The link's path gives the date, the block and `?p=`. The host is
     ignored, as the scan box already does.
4. **Find the print run.** The QR code names the sheet, not the copy. If the
   Dispatch Log changed between the evening print and the morning reprint,
   two different printed pages carry the same code.
   - The **footer print time** identifies the run. It is printed text, and
     the reader returns it.
   - Each row's **printed trip name** ("320-E") maps the row to a trip.
   - To make the mapping exact rather than inferred, the print log should
     store **the trip IDs printed on each sheet, in row order**.
     `RidershipPrintedSheets` keeps only a fingerprint today. This is a small
     migration, and worth landing before December's sheets are scanned.
5. **Check for duplicates.** A second page with the same date, block and page
   is kept, and marked **duplicate** (or **superseded**, when it comes from
   an older print run). If the two pages read differently, OCC sees both.
6. **Check for missing sheets.** Each garage has a list of expected sheets:
   its blocks from `RidershipBlockGarages` that have Dispatch Log trips on
   the date. The list feeds completeness, as **not scanned**, and §15's
   "sheet expected but never scanned".
   - A page 1 without its page 2 is "page missing".
7. **Check that the date makes sense.** A QR date more than 2 days from the
   upload date is flagged "check date". The cause would be an old sheet
   reused, or a photocopy, which the nightly print rule forbids.

Unreadable and unassigned pages go to a short queue on the upload page (for
the desk) and on the worklist (for OCC).

## 3. Reading handwriting

### What gets read

Only boxes and ticks. Nothing free-hand.

| Field | How |
|---|---|
| Trip total (3 digit boxes) | Reader + geometry. A leading empty box is accepted (` 27`). An empty box between two digits is an error. |
| DNO tick, Reconstructed tick, unscheduled Why ticks | **Ink measurement**, no AI. Proven in the feasibility check. |
| Box filled or empty | Ink measurement. This is the first check on every reading: a digit read in a box OnBoard measured as empty is thrown out. |
| Operator ID (5 boxes), bus (4 boxes) | Reader. Compared with Avail's pull-out pre-fill; a mismatch is highlighted, never applied. |
| Unscheduled rows | v1: OnBoard only detects that a row has writing, and **highlights it for OCC to key from the image**. Circled N/S/E/W and AM/PM, and four-digit times, are not worth automating for about 0–3 rows a day. |
| **Operator name, initials, tally** | **Not read.** The name and initials areas are **masked white** before any image leaves OnBoard. |

**Conflicts are highlighted, never resolved by OnBoard.** These are:

- a tick and a total on the same trip;
- a blank trip with no tick;
- DNO against a trip the Dispatch Log says ran.

### Cleaning the page first

Box borders are the commonest cause of misread digits in comb fields: a
general reader sees a box edge as a "1" or a "|". OnBoard knows exactly where
every printed line is, so before reading it **removes the printed lines**.
There are two ways:

- subtract a re-rendered blank of the same sheet (`countSheetPdf.ts` can
  render it exactly from the stored print run);
- or white out the known rule positions.

Only the handwriting is left in the boxes. The in-house reader option would
crop to the box interiors and get the same effect.

### The three readers compared

Costs are at about **3,500 pages a month**, at list prices as last
published. These figures come from third-party price listings, because the
Azure pricing page did not render. Confirm them in the Azure calculator
before ordering.

| | Document Intelligence: prebuilt Read or Layout | Document Intelligence: custom model on our form | Azure OpenAI vision (GPT-4o class) | In-house digit classifier |
|---|---|---|---|---|
| **Cost per page** | Read about $0.0015; Layout about $0.010 | Custom extraction about $0.030. Training a template model is free. | About $0.002–0.007: roughly 1,000–1,500 image tokens plus a short prompt. Depends on the model. | About $0 marginal; runs on the REST Function App or a queue worker |
| **Per month** | **About $5 (Read) / about $35 (Layout).** The F0 free tier (500 pages a month) covers the Burnsville pilot. | About $105 | About $7–25 | About $0 in Azure. Weeks of engineering, plus upkeep. |
| **Training** | None | About 5–50 labelled sheets. December provides them. | None (prompting) | Thousands of labelled boxes: start from public digit sets (MNIST/EMNIST), then fine-tune on December's boxes |
| **Accuracy on digit boxes** | Handwriting is supported, with word-level confidence and polygons. Untested on boxed single digits by our operators. Line removal and geometry mapping matter more than the model. | Usually better than prebuilt on a fixed form, because it learns where each field is. Our geometry already gives that. | Good at reading context (a crossed-out digit, a "27" spilling over a box edge). But it can return a **plausible wrong number with no warning**, its confidence is not calibrated per digit, and repeat runs can differ. | Per-box, deterministic, and its confidence is calibrated after tuning. Weak on anything unusual (a strike-through, writing outside the box). Quality depends on the training data. |
| **Latency** | Seconds per page (async API) | Seconds | Seconds to tens of seconds | Milliseconds |
| **Data residency and personal data** | Processed in the resource's region (OnBoard runs in **West US 2**). Not used to train Microsoft's models. The page and its result are held only briefly for the async API to retrieve (verify the current period on Microsoft's data-privacy page). The name is masked, so what leaves OnBoard is digits and printed text. | Same. The training sheets are stored in our own storage. | Prompts, including images, are kept for **abuse monitoring** (widely reported as up to 30 days) and may be reviewed by people, unless MVTA is approved for **Modified Abuse Monitoring**. A Data Zone US deployment keeps processing in the US. | Nothing leaves OnBoard. |
| **Fits the codebase** | A REST call and a key-less managed identity, like the other Azure services | Same, plus a labelling step in Document Intelligence Studio | REST call | A model runtime (ONNX) in Node Functions. Nobody on the team maintains ML today. |

Latency doesn't decide anything here: sheets are due by the end of the next
day, so any of these is fast enough.

### Recommendation

**Start with prebuilt Read, on a line-removed, name-masked page.**

- OnBoard's own geometry assigns each recognised word to its box, and uses
  the box's ink to accept or reject it.
- **Layout** is a one-line switch if Read misses digits. The ticks never
  need Layout's selection marks, because OnBoard measures them itself.

**Prove it with a trial before anything reaches OCC.** The trial uses
December's Burnsville scans, labelled by OCC's own keyed counts. It
compares:

- Read;
- Layout;
- a custom template model trained on about 20 sheets;
- a small in-house classifier on the box crops.

Azure OpenAI is in the trial only if the user approves sending masked crops
to it. It is **not recommended as the reader**. It is the option most likely
to produce a confident wrong number, and the one with the weakest
data-retention story for handwriting.

**Trial measures** (the thresholds are proposals for the user to set):

- **Wrong and confident:** of the values OnBoard would pre-fill (above the
  threshold), **no more than 1 in 200** is wrong. This is the number that
  matters, because a wrong pre-filled value is the one OCC is most likely to
  wave through.
- **Coverage:** at least **80% of trips** get a pre-filled value.
- **Ticks and empty boxes:** at least 99.5% right.
- **Keying time** per sheet, with readings against without, measured at the
  pilot desk.

A custom model, or the in-house classifier, is built only if Read and Layout
fail the first two measures.

## 4. Into OnBoard

### The flow

1. The desk uploads. OnBoard stores the original, then splits, identifies and
   reads each page **on a queue**. It does not do this inside the upload
   request.
   - The REST app runs on one B1 worker, which was saturated in September.
     The queue worker processes **one page at a time**, so a 150-page upload
     cannot starve the API.
2. A sheet with a recognised page gets a new worklist state, **Scanned**
   (scanned, awaiting confirmation). It sorts after Late and before Not
   entered.
3. OCC opens the sheet form, as today:
   - The **page image** sits beside the form. Each trip row also shows **its
     own box strip**, so OCC compares the reading with the handwriting
     without looking away.
   - **High-confidence** readings are **pre-filled**, in a distinct "from
     scan" style.
   - **Low-confidence** readings, conflicts and unreadable boxes are left
     **empty and highlighted**, with the reading shown as a hint ("read as
     27?"). Enter stops at each one, so OCC has to type it.
   - The confidence threshold is a setting, not code.
   - An operator ID or bus that differs from Avail is highlighted next to the
     existing override.
4. **Save** is the person confirming every value on the sheet. Nothing is
   saved without it. A reading never writes `RidershipCounts`.
5. Every count stores its **source**:
   - `scan`: confirmed exactly as read;
   - `keyed`: typed or corrected.

   The reading itself is kept, so a correction keeps both what the scan said
   and what OCC saved.

### Schema (one migration, next free number)

- **`RidershipScanUploads`**: one row per uploaded file.
  - `upload_id`, `uploaded_at`/`by`
  - `source`: `upload` | `photo` (later `folder`)
  - `blob_path` of the **original as received**, `sha256`, `page_count`,
    `garage` (as chosen)
  - processing status
- **`RidershipScanPages`**: one row per page.
  - `page_id`, `upload_id`, `page_index`
  - `image_path`: the straightened page, a derived copy
  - `qr_text`, `service_date`, `block`, `sheet_page`
  - `identified_by`: `qr` | `printed_text` | `person` (with who and when)
  - `print_id`: the matched print run
  - `state`: `matched` | `blank` | `duplicate` | `superseded` |
    `unreadable` | `ignored`
  - `read_state`, `reader` (engine and model version), `read_at`
- **`RidershipScanReadings`**: one row per field read.
  - `page_id`, `row_kind` (`trip` | `added_row` | `header`), `trip_id` or
    row number
  - `field`: `total` | `dno` | `operator_id` | `bus` | `reconstructed` |
    `row_has_writing`
  - `value` (text), `confidence`, `needs_review`, `reason`
    (`low_confidence` | `conflict` | `empty` | `unreadable`), the box polygon
- **`RidershipCounts`** gains:
  - `source NVARCHAR(10) NOT NULL DEFAULT 'keyed'`, checked to be `keyed` or
    `scan` (`kiosk` arrives with the kiosk pilot);
  - `scan_reading_id BIGINT NULL`.

  `RidershipCountHistory` records changes to `source` like any other field.
- **`RidershipSheets`** gains `first_scanned_at`.
- **`RidershipPrintedSheets`** gains `trip_ids NVARCHAR(MAX)`: a JSON array,
  in printed row order. This one can land before December (§2, step 4).
- All of these are added to `SCHEMA_REQUIREMENTS` in `lib/schemaDrift.ts`,
  with the usual 503 "run migration NNN" guards.

### API

| Method and route | Who | What |
|---|---|---|
| `POST /api/ridership/scans` | `ridership.scan` | Creates an upload. Returns a short-lived **write-only** user-delegation SAS URL for the original. |
| `POST /api/ridership/scans/{uploadId}/submit` | `ridership.scan` | Checks the hash and size, then queues processing. |
| `GET /api/ridership/scans?date=&garage=` | `ridership.scan` | The upload's page outcomes (no images), unassigned pages, and the garage's expected sheets that have not been scanned. |
| `PATCH /api/ridership/scan-pages/{pageId}` | `ridership.scan` | Assign block, date and page by hand, or mark a page ignored or blank. Recorded with who and when. |
| `GET /api/ridership/scan-pages/{pageId}/image` | `ridership.scans.view` | Redirects to a **5-minute read SAS URL**. Every open is logged. |
| `GET /api/ridership/sheets/{date}/{block}` (existing) | as today | Adds `scan: { pages, readings }`. The image links appear only for `ridership.scans.view`. |
| `PUT /api/ridership/sheets/{date}/{block}` (existing) | `ridership.enter` | Each trip may carry `scan_reading_id`. The **server** sets `source = 'scan'` only when the saved value equals the reading, so the client cannot claim a scan source. |
| Queue `ridership-scan-pages` | system | Split, straighten, identify, mask, read and store readings, one page per message. A retry after a failure does not duplicate the work. |

### Completeness and lateness

**Is the upload time the entry time? Recommendation: no.** `entered_at` stays
"the first time a person saved the sheet complete" (migration 153).

- A count exists only when a person has confirmed it. If the upload time
  counted, a sheet could be "on time" while holding no count at all.
- Scanning and confirming are both the contractor's work: the garage desk
  scans and Keolis OCC confirms. So the contract's "timely" word sits fairly
  on confirmation.
- The scan *helps* OCC meet the deadline: OCC can confirm from the image
  without waiting for the paper to travel.
- If the reader is down, OCC keys from the image as today, so a late sheet is
  never OnBoard's fault.
- `first_scanned_at` is recorded and shown, so a dispute can tell "scanned on
  time, confirmed late" (an OCC delay) from "never scanned" (a garage desk
  delay).

**The alternative** is to judge timeliness on `first_scanned_at`, with a
separate confirmation window. That would make sense only if MVTA wanted the
garage's hand-in judged apart from OCC's keying. It is a decision for the
user (decision 4).

**Completeness by garage** gains two counts:

- **scanned, not yet confirmed**;
- **not scanned**: an operational measure for the desk, not an occurrence.

**Flags (Jan 1).** The outlier rule (§6) can run on readings *before*
confirmation, to highlight a proposed value that would flag. A misread
"127" for "27" is exactly the kind of value that rule catches. After
confirmation, flags work as specified, on the saved count.

**Kiosk comparison (later, §15).** A confirmed scan that differs from a kiosk
submission becomes a flag. The `source` column and the readings table are
enough for that, and nothing here depends on how the kiosk signs in.

## 5. Storage and retention

**Account.** A **dedicated** private storage account, one per environment,
defined in Bicep next to `storage-detour-images.bicep`:

- shared-key access off, managed identity only, user-delegation SAS;
- CORS limited to the console's hostname, for the direct upload.

It is separate from the detour images account, because immutability is set
per container and needs versioning on.

**Containers.**

- **`count-sheet-originals`**: the file exactly as uploaded. Its `sha256` is
  in the database.
  - **Version-level immutability (WORM)**, with a time-based retention
    policy. The policy stays **unlocked** until records management sets the
    period X. That still blocks deleting or overwriting any original. Once X
    is set, the policy is **locked**, and after that it can only be
    lengthened. This matches §15: "until the period is set, nothing is
    deleted".
- **`count-sheet-pages`**: straightened, derived page images and box strips.
  They can be rebuilt from the originals, so they are not WORM. A lifecycle
  rule deletes them at X.

**Size and cost.** A 300 dpi page is about 0.1–0.4 MB, depending on
bilevel or grayscale and on compression. That is about 1 GB a month, or
12 GB a year. Hot LRS storage is cents a month in year one and only a few
dollars a month after several years, less if older originals move to the
cool tier. Moving tiers is allowed under immutability.

**Who sees a scan.** A scan shows the operator's name and handwriting, so it
follows §10's operator-name rule:

- The new action **`ridership.scans.view`** is held by `ridership-recorder`,
  `ridership-manager` and the compliance roles. If the January increment
  adds an operator-names action, scan viewing should use that same action
  rather than a second one.
- `ridership-printer` (the desk) uploads but **cannot view**.
- Every image open is logged with who, when and which page.
- Totals and exports never carry images.
- **Real scans go to prod only.** Dev stays on synthetic sheets rendered by
  `countSheetPdf.ts`, the same rule as for real operator names in the repo.

**Releasing the paper early.** Today the contractor keeps the paper until the
month's Assessment Period is final and its dispute window has passed (§8).
With scanning, the paper for a sheet could be released once three things are
true:

- its scan is stored in the locked container;
- the scan is identified, and passes a legibility check (all four marks
  found, and every box readable or confirmed by a person);
- the sheet is confirmed.

A practical rule is "after the month is closed". That needs **records
management to accept the scan as the record copy** (including a minimum of
300 dpi), and OPR-038 and the contractor procedure to say so. Until both
happen, the paper is kept as today.

## 6. Phasing

**Before Dec 1: nothing.** Dec 1 entry, the parallel Access run, and Jan 1
flags and close are the critical path. The sheet already carries everything
the reader needs, so **nothing on the printed sheet changes**.

| When | Increment | Notes |
|---|---|---|
| **Early December (optional, small)** | Store the trip IDs printed on each sheet (`RidershipPrintedSheets.trip_ids`) | Makes December's scans map exactly. A backend merge restarts the REST app, so merge it outside 4am–midnight Central. |
| **Mid-December: Burnsville capture pilot** | **S1:** storage, the upload page, the queue worker (split, straighten, identify), Scanned / Not scanned on the worklist, the scan image beside OCC's form. **No reading.** | **Yes, possible.** About 20 sheets a weekday, on the smaller garage. It gives OCC the image without waiting for the paper, and it builds the trial set: OCC keys every December sheet anyway, so the labels are free. It adds one step for the Burnsville desk during cutover month. If the desk can't take that on, start on Jan 2. |
| **January (offline)** | **S2:** the reading trial on December's Burnsville scans (§3) | Scripts outside production. The result is a one-page decision note: which reader, which threshold. |
| **After the January close (February)** | **S3:** readings shown as proposals on the sheet form, Burnsville only | Measure keying time and corrections against manual entry. |
| **March onward** | **S4:** every garage (Eagan, about 124 weekday sheets). Scan-versus-kiosk comparison, with the kiosk pilot. | Matches §15's "after the March close" for the kiosk pilot. |

This **moves capture earlier than §15**, which put all scanning "with the
kiosk pilot, after the March 2027 close". The reason: the reading trial needs
labelled sheets, and December is the one month in which OCC keys every sheet
twice anyway. That is decision 1.

### Steps outside the code (numbered, owner in brackets)

1. **Find out what each garage's MFP can do:** the make and model; scan to
   PDF at 300 dpi; and the destinations it supports (PC or USB, email,
   SharePoint). Also who owns and supports the MFP: MVTA or Keolis. [MVTA IT
   + Operations]
2. **Approve the new Azure resources and their cost:** a storage account per
   environment, and a Document Intelligence resource (F0 for the trial, S0
   after). [User]
3. **Create the storage account** in `rg-mvta-onboard-prod` (and dev) from
   Bicep, with versioning, the immutable `count-sheet-originals` container
   with its retention policy unlocked, and CORS for the console. Then
   **grant the REST app's managed identity** `Storage Blob Data Contributor`
   and the delegator role on the account. [Engineering; the role grant is
   run by the user]
4. **Create the Document Intelligence resource** in West US 2. Disable local
   (key) auth, and **grant the REST app's managed identity** `Cognitive
   Services User`. [Engineering; the role grant is run by the user]
5. **Seed the new actions and grant the roles.**
   - **Seed** `ridership.scan` into `ridership-printer`, `ridership-recorder`
     and `ridership-manager`, and **seed** `ridership.scans.view` into
     `ridership-recorder`, `ridership-manager` and the compliance roles. This
     is done by a migration, mirrored in `seeds.ts` and `mockAccess.ts`
     (ADR 0032).
   - Then, in Access & Identity, **assign** the Ridership Printer role to the
     **Burnsville desk staff** who will scan. (Migration 159 is still pending
     on prod.)
   - These are app-owned roles, so **there is no Entra app-role step**. The
     Keolis desk staff still need their Entra B2B guest accounts.

   [Engineering + an access administrator]
6. **Set the retention period X, and decide whether the scan becomes the
   record copy.** Then lock the container's policy. [Planning / records
   management, then Engineering]
7. **Data-protection sign-off** on sending name-masked page images to
   Document Intelligence in West US 2. If Azure OpenAI is in the trial, also
   on that, and apply for Modified Abuse Monitoring first. [MVTA IT /
   security]
8. **Amend the contractor procedure and OPR-038.** The desk scans each
   shift's sheets and uploads them by a set time. Staples come out, and pages
   are fed face down. The paper is kept until released. Give these to the
   ridership-sop session's draft. [Planning + Operations]
9. **Train the Burnsville desk** (about 30 minutes: scan, upload, fix
   unreadable pages) and **OCC** (about 30 minutes: what pre-filled and
   highlighted mean, why Enter stops, how to confirm or correct). Then train
   Eagan before S4. [Operations + Keolis]
10. **Hold a pilot review** after two weeks of S3. Planning and Operations
    decide on rollout to every garage from the trial measures. [Planning +
    Operations]

## Monthly cost, at about 3,500 pages a month

| Item | Read (recommended) | Layout | Custom model |
|---|---|---|---|
| Document Intelligence | about $5 (F0 free covers the Burnsville pilot) | about $35 | about $105 |
| Storage (originals and pages, year 1) | under $1 | under $1 | under $1 |
| Queue and Function compute | about $0 (existing plan) | about $0 | about $0 |
| **Total** | **about $5–6** | **about $36** | **about $106** |

Azure OpenAI, if it were used, would add about $7–25. An in-house classifier
adds no Azure cost but is the most engineering time.

**Rough engineering estimate:**

- S1: 2–3 PRs (storage, upload, worker, form panel);
- S2: a trial of about a week;
- S3: 1–2 PRs (readings, proposals UI, `source`).

## Decisions for the user

1. **Pilot capture at Burnsville in mid-December** (ahead of §15's "after the
   March close"), so December produces the reading trial's labelled set? Or
   start on Jan 2, or keep §15's timing?
2. **Capture route:** the upload page first (recommended), or scan-to-folder
   or scan-to-email, depending on the MFPs (step 1).
3. **Reader:** prebuilt Document Intelligence Read/Layout first, with a custom
   model or an in-house classifier only if the trial fails (recommended).
   Should Azure OpenAI be in the trial at all?
4. **Lateness:** keep `entered_at` as OCC's confirmation (recommended), or
   judge it on the scan time?
5. **Confidence policy:** pre-fill above a threshold and make OCC type
   everything below it (recommended). Also: the trial's targets (no more than
   1 in 200 pre-filled values wrong, at least 80% of trips pre-filled), and
   whether to audit a random sample of confirmed sheets each month.
6. **Who views scans:** a new `ridership.scans.view` action, or the January
   operator-names action, if that is its name. Should the compliance roles
   have it?
7. **Paper release:** ask records management to accept the 300 dpi scan as
   the record copy, so paper is released after month close rather than after
   the dispute window.
8. **Print-log trip list:** land `RidershipPrintedSheets.trip_ids` in early
   December, so December's sheets map exactly?

## Sources

- [Azure AI Document Intelligence pricing (third-party listing; the Azure page did not render prices)](https://erpresearch.com/erp-add-ons/ocr/azure-document-intelligence/pricing)
- [LiteLLM: Azure Document Intelligence price table](https://docs.litellm.ai/docs/providers/azure_document_intelligence)
- [Microsoft Q&A: custom extraction model pricing](https://learn.microsoft.com/en-au/answers/questions/1694517/azure-ai-document-intelligence-custom-extraction-m)
- [Microsoft Q&A: Azure OpenAI data management and abuse monitoring](https://learn.microsoft.com/en-us/answers/questions/2156579/azure-openai-data-management-and-abuse-monitoring)
- Dev Dispatch Log page counts: `TripStartLog`, 2026-10-05 to 2026-11-01, read-only query.
