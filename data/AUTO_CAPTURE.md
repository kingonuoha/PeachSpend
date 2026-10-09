# Auto-capture runtime seam

`AutoCaptureRuntime` owns reconnect processing for candidates already placed in SQLite `capture_queue`.

Native integration must provide `NativeAutoCaptureEventSource` and pass it to `start(source)`. This repository does not install or emulate a notification-reading detector. Without that native event source, `getStatus()` reports `nativeEventSourceAvailable: false`; no automatic trigger is claimed. Explicitly queued candidates still process locally when the app starts or connectivity returns.

Queue failures remain persisted with bounded retry backoff. Duplicate candidates are recorded as `duplicate_skipped` and removed from queue.
