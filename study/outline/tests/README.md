# Outline ink latency regression (2026-11-08)

Run with Node 22+ (no dependencies):

```
node study/outline/tests/ink-latency.cjs
node study/outline/tests/ink-benchmark.cjs
```

Evidence from code: pen input previously waited for requestAnimationFrame. An
already-queued idle save could start after the next pen-down without rechecking
`state.drawing`; IndexedDB completion also unconditionally stringified the whole
notebook into localStorage, even during a new stroke. These are independently
reproducible main-thread interference paths, not a proven diagnosis of a specific
user's device.

The fix submits incremental opaque ink in the input task (including the first
dot), keeps translucent highlighter snapshots frame-batched, cancels stale idle
saves and checks drawing at execution/completion. The canvas requests the browser's
optional desynchronized low-latency mode, with the existing fallback. Lifecycle
saves first commit the captured last stroke, and `pagehide` covers BFCache/mobile
navigation. IndexedDB, data format, sync, page dimensions, text/images, lasso and
undo/redo behavior are otherwise unchanged.

The VM regression harness executes extracted production functions with mocked
canvas/scheduling/storage boundaries. It checks syntax, both save races, idle
cancellation, immediate pen/eraser dispatch, highlighter batching, lifecycle save,
and actual pointercancel stroke/undo commit.

The synthetic benchmark uses 12 pages, 8,400 strokes × 80 points and 12 synthetic
image sources, and deliberately places full-notebook serialization between input
and the next animation frame. One box run: first canvas call 243.59 ms before,
0.19 ms after; 21.1 MB serialization still takes ~250 ms. This measures JS task
ordering only, NOT rasterization, display latency or improvement on the user's
device. The serialization cost has not disappeared, and sync or browser/device
load can still delay an input task that has not started.

Device acceptance (requires a real browser/pen; not run by this code-only harness):
open an existing large notebook without clearing storage, write several short
strokes then a long stroke; pause 2–4 seconds and resume quickly (save race), test
pen/eraser/highlighter, pan/zoom, lasso, text/image placement, undo/redo; write and
immediately background/return/reload and confirm the final stroke and images
survive. Check another device's normal sync behavior. Record actual input-to-ink
latency on that device before declaring the symptom resolved.

## Whole-app follow-up (after user reported the first fix insufficient)

New tests:

```
node study/outline/tests/performance.cjs
node study/outline/tests/main-thread-benchmark.cjs
```

Source-confirmed shared UI-thread work: each encrypted sync encoded the entire
notebook and built its base64 string by concatenating one character per byte;
unchanged five-second auto-polls still decoded/decrypted/parsed/merged all data;
localStorage fallback serialized the whole notebook on the main thread. Screen
background redraws submitted lines for the entire page height despite using a
viewport-size canvas. Pen/eraser submitted a separate stroke() per new segment.
Existing live pen rendering was already independent of historical strokes; the
follow-up does not falsely claim to have removed a per-move full-history redraw.

The optional same-origin worker now handles sync JSON/base64/crypto and normal
fallback JSON. Envelope v1, PBKDF2/AES parameters, IndexedDB schema, keys, union/
tombstone merge rules and manual refresh remain unchanged. Worker load failure
uses the old page path; wrong-password errors propagate. Base64 fallback uses
32KB chunks instead of millions of one-character concatenations. Unchanged quiet
pulls skip decode/merge only if ciphertext, vault, DATA reference and local
updatedAt all match a successful pull. New edits invalidate the shortcut and edits
arriving during encryption queue another push. Lifecycle fallback remains
synchronous, and stale worker fallback output cannot overwrite newer revisions.

Background geometry is clipped to the viewport for screen use; full-page export
retains full geometry. Cached stroke bounds avoid rescanning every historical
point on revisits. Equal-width pen/eraser subpaths are batched without connecting
independent segments or changing their widths; highlighter behavior is unchanged.
A remote apply renders before asynchronous IDB completion, so it cannot discard a
new stroke which started during that wait.

One synthetic Node run, 12 pages, 2400 *distinct* strokes ×80 points plus 12×100KB
image strings:

| Work | Total | Largest main-thread 5ms-heartbeat gap |
| --- | ---: | ---: |
| Original main-thread sync encrypt/base64 | 1379.7ms | 1319.8ms |
| Worker sync encrypt/base64 | 344.8ms | 42.2ms |
| Original main-thread fallback JSON | 77.2ms | 81.4ms |
| Worker fallback JSON | 184.1ms | 56.5ms |

Worker postMessage cloning still blocked 36.8–51.2ms in that run, and worker
fallback has greater total overhead. These are not browser INP or user-device
results. localStorage.setItem, IDB clone, first history scan, remote merge and
browser rasterization can still block and have not been proven fast on the user's
device. Full 120000px lined-page screen background commands fall from 4286 line
segments to 44; grid 5030 to 81. A 100-segment equal-width live batch falls from
100 stroke calls to 1; pressure width changes retain separate batches.

Storage-free browser fixture: `study/outline/tests/perf-fixture.html`. Compare
full-export-clipped versus viewport backgrounds (lined/grid), then run the worker
roundtrip with the animated green dot. It reads production function source but
never loads the app or accesses the user's storage/accounts. Real existing-note
navigation/scroll/write/save/sync checks are still required before asserting the
user's overall lag is resolved.

## Black-page report: staged compatibility repair

The screenshot's Android compositor behavior has NOT been reproduced on this box.
The renderer explicitly fills paper `#fffef8`; no source path intentionally fills
the entire paper black. The newly enabled desynchronized transparent context plus
existing self-copy `globalCompositeOperation='copy'` is a compatibility suspect,
not a proven device diagnosis. The repair removes both accelerated dependencies:
normal alpha Canvas2D and repaint retained strokes on viewport relocation. Worker,
sync and viewport-only background work remain. Scroll can do more redraw work,
which is an intentional correctness-first trade-off. No stored content changes.

`canvas-pixels.cjs` executes actual renderer functions on a native CPU canvas and
checks 36 combinations (37/100/114% zoom, lined/grid/blank, 1/100 sheets, DPR1/2,
scrolled viewport, pen/eraser). These are real raster pixels but NOT browser/GPU
compositing. Dependency is installed outside the repository under
`/workspace/canvas-regression-tools/node_modules/@napi-rs/canvas`.

BEFORE MERGE: open the storage-free `tests/black-page-fixture.html` in a real
browser. Left is the repair, right recreates previous context/self-copy choices.
Check 37%, 100%, 114%, offset0/72000, all backgrounds and repeat redraw. Left paper
must stay cream with blue/black/yellow marks and a transparent eraser cut. Read
context attributes/empty pixel output and take screenshots. A desktop pass does
not establish Android compatibility; if the screenshot symptom remains, further
device investigation is needed. Never clear actual storage as a diagnostic step.

Release decision: the browser could not reach the box HTTP fixture and file URLs
were blocked, so no browser visual verification occurred. The conservative
compatibility rollback is released with the CPU raster/regression checks only;
Android cause and symptom resolution remain unverified. The public fixture after
Pages deployment is available for a subsequent real-browser check.

## Sync fix: tablet ink not reaching the phone (2026-11-11)

Cause (from Cloudflare analytics + KV): the encrypted vault had grown to 19.84 MB,
just under the old Worker's 20,000,000-char PUT limit. Every upload since
2026-11-04 11:30 UTC was rejected (`PUT 413`, zero KV writes since), so new tablet
ink never reached the cloud. The old Worker also buffered 20 MB strings
(`exceededResources` errors), and every 5-second poll downloaded the whole vault.

Fix: envelope v2 = ink coordinates rounded to 0.01 px (only strokes with an id) +
gzip, then AES-GCM (≈ 8× smaller; v1 still readable). The Worker (`sync-worker/`,
deployed as `gkc-notes-sync`) streams GET/PUT, allows 25 MB, stores a revision in KV
metadata, answers `?meta=1` cheaply for unchanged polls, and supports
compare-and-swap (`X-Base-Rev` → 409) so a device that merged an older copy re-reads
and merges instead of overwriting newer ink. Old clients cannot decrypt v2, so they
fail closed (no upload) until refreshed.

```
npm i miniflare@3   # or MINIFLARE_PATH=/path/to/node_modules/miniflare
node study/outline/tests/sync-two-devices.cjs
```

## Lasso picked up erased ink (2026-11-12)

```
node study/outline/tests/lasso-eraser.cjs
```

Report: "지우개로 지우면 뭔 이상한게 올가미로 잡히는데?". The eraser is stored as a
destination-out stroke after the ink, so erased ink still exists in the data. Lasso
selected and outlined it (blue outline of invisible/erased writing, oversized box).
Lasso now computes per-point visibility against later eraser strokes: fully erased
ink is not selectable or outlined, erased parts of a stroke are not outlined or
counted in the box, and erasers move only with ink they actually cut. Stored
strokes/sync data are unchanged. The test fails on the previous version.

### Follow-up: moved ink got erased (2026-11-12)

Report: "올가미로 필기 가져오면 지우개 영향 때문에 필기가 삭제됌". Moved ink kept its old
z-order, so eraser strokes drawn later anywhere (e.g. an old erase at the destination)
cut it, and erase strokes carried with the selection cut other writing at the
destination. Now erasers are never selected; on the first move (and on copy) the
selected ink is replaced by its visible pieces only (new ids, originals tombstoned
via setStrokes, erasers stay put) placed on top, so it arrives intact and erased
parts don't come back. Undo/pinch-cancel restore the original page snapshot.
Data format unchanged. Cases 7–11 of lasso-eraser.cjs fail on the PR19 version.

## PDF 넣기 (2026-11-14)

```
node study/outline/tests/pdf-insert.cjs            # logic: ranges, placement, size limits
node study/outline/tests/pdf-insert-browser.cjs    # headless Chrome + vendored pdf.js (needs puppeteer-core, pdf-lib)
MINIFLARE_PATH=... node study/outline/tests/sync-two-devices.cjs   # step 9: 30 PDF pages + ink sync
```

"📄＋ PDF" renders chosen pages on the device with vendored pdf.js 3.11.174 (legacy
build, `vendor/pdfjs-3.11.174/`, loaded only when used; the PDF itself is never
uploaded). Each page becomes an ordinary image (same data as 🖼 photos: JPEG q0.72,
1200px wide = 1.5× the 800px page) on its own new sheet below existing content, so
pen/highlighter/eraser/lasso behave exactly as on photos (eraser cuts ink only).
Max 30 pages per insert. When sync is on, the upload size is estimated (last
payload + new image data; verified within ~1% by the sync test): over 20 MB asks
for confirmation, over the 25 MB limit refuses. Data format unchanged.
