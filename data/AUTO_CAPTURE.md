# Auto-capture runtime seam

`AutoCaptureRuntime` owns reconnect processing for candidates already placed in SQLite `capture_queue`.

Native integration must provide `NativeAutoCaptureEventSource` and pass it to `start(source)`. This repository does not install or emulate a notification-reading detector. Without that native event source, `getStatus()` reports `nativeEventSourceAvailable: false`; no automatic trigger is claimed. Explicitly queued candidates still process locally when the app starts or connectivity returns.

Queue failures remain persisted with bounded retry backoff. Duplicate candidates are recorded as `duplicate_skipped` and removed from queue. Push plus SMS twins (same normalized merchant plus same amount within `QUEUE_DEDUP_WINDOW_MS`, 15 minutes, of a pending or claimed event) collapse into one draft; the dropped twin is recorded as `duplicate_skipped` for the S-22 diagnostic card. The confirm time duplicate check stays the second net.
