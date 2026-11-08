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
