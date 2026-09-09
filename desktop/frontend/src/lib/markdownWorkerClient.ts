// markdownWorkerClient — request/response client for markdown.worker.ts, the
// off-main-thread Markdown parse (Phase E). Follows the regexSearchClient
// precedent (`?worker&inline`, lazy spawn) with a few additions the transcript
// needs:
//
//   - One parse at a time. Cancelling the active request terminates the worker,
//     so a stale giant document cannot keep consuming CPU after a tab switch.
//   - Cancellation resolves with `undefined` (never rejects), so unmounted
//     rows and superseded generations settle quietly.
//   - When Worker is unavailable (jsdom/tests) or the inline chunk fails to
//     load, parsing falls back to the isomorphic in-process pipeline.
//   - dispose() terminates the worker and settles every pending request.
//     The app-level singleton is lease-counted: Transcript instances acquire
//     on mount and release on unmount, and the worker terminates when the
//     last lease goes away so a closed session set never leaks the thread.
//
// Only lazy markdown chunks may import this module: its fallback path pulls in
// the full parse pipeline (remark + katex), which must stay out of the shell.

// Only type imports from the pipeline: the fallback parser is loaded on demand
// so this module stays light enough for the eager transcript graph, and the
// remark+katex stack only ever lands in lazy chunks / the inline worker.

import type { MarkdownParseResult } from "./markdownPipeline";
import type { ChatPathLinkifyContext } from "./chatPathLinkify";
import { addBreadcrumb } from "./breadcrumbs";
import { registerMarkdownWorkerDiagnostics } from "./sessionDiagnostics";

type MarkdownPipelineModule = typeof import("./markdownPipeline");
let pipelinePromise: Promise<MarkdownPipelineModule> | null = null;
function loadPipeline(): Promise<MarkdownPipelineModule> {
  if (!pipelinePromise) pipelinePromise = import("./markdownPipeline");
  return pipelinePromise;
}

export interface MarkdownParseRequest {
  id: number;
  text: string;
  /** Workspace roots enabling chat-path linkification (optional). */
  pathCtx?: ChatPathLinkifyContext;
}

export interface MarkdownParseResponse {
  id: number;
  result?: MarkdownParseResult;
  error?: string;
}

export interface MarkdownWorkerLike {
  onmessage: ((event: MessageEvent<MarkdownParseResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(request: MarkdownParseRequest): void;
  terminate(): void;
}

export interface MarkdownParseHandle {
  /** Resolves the render blocks and selection projection together. */
  promise: Promise<MarkdownParseResult | undefined>;
  /** Drop the response when it arrives; resolves the promise with undefined. */
  cancel(): void;
}

export interface MarkdownWorkerClientOptions {
  /** Override worker creation (tests inject a synchronous fake). */
  createWorker?: () => Promise<MarkdownWorkerLike>;
  /** Override the in-process fallback parse (tests inject a spy). */
  parseInProcess?: (text: string, pathCtx?: ChatPathLinkifyContext) => MarkdownParseResult;
}

interface PendingRequest {
  resolve(result: MarkdownParseResult | undefined): void;
  reject(error: Error): void;
  /** performance.now() at parse() time, for parse-latency diagnostics. */
  startedAt: number;
  text: string;
  pathCtx?: ChatPathLinkifyContext;
  state: "queued" | "worker" | "fallback";
  /** performance.now() when the request was posted to the worker (worker path). */
  postedAt?: number;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// A synchronous fallback parse of >=FALLBACK_BREADCRUMB_MIN_MS is a real
// main-thread freeze worth attributing in crash/perf reports. Smaller ones
// stay breadcrumb-silent so a streaming session cannot flood the 30-entry
// ring and push out the surrounding context.
const FALLBACK_BREADCRUMB_MIN_MS = 100;

function noteFallbackParseBreadcrumb(durationMs: number): void {
  if (durationMs < FALLBACK_BREADCRUMB_MIN_MS) return;
  addBreadcrumb("markdown", `fallback parse ${Math.round(durationMs)}ms (main thread)`);
}

export class MarkdownWorkerClient {
  private readonly createWorker?: () => Promise<MarkdownWorkerLike>;
  private readonly parseInProcess?: (text: string, pathCtx?: ChatPathLinkifyContext) => MarkdownParseResult;
  private worker: MarkdownWorkerLike | null = null;
  private workerPromise: Promise<MarkdownWorkerLike | null> | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private activeRequestId: number | null = null;
  private pumping = false;
  private nextId = 1;
  private disposed = false;
  // Content-free diagnostics (sessionDiagnostics / crash perf context). The
  // worker/fallback split is the signal that answers "did the parse run
  // off-main-thread or freeze the event loop": the fallback path is a
  // synchronous main-thread parse, so its counters are the ones to watch in
  // event-loop-lag reports.
  private completedParses = 0;
  private totalParseMs = 0;
  private maxParseMs = 0;
  private workerParses = 0;
  private workerTotalMs = 0;
  private workerMaxMs = 0;
  private fallbackParses = 0;
  private fallbackTotalMs = 0;
  private fallbackMaxMs = 0;
  private fallbackActive = false;
  private workerFailures = 0;
  /** Test/diagnostic introspection: in-flight request count. */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Parse-pipeline counters for the diagnostics snapshot. */
  stats() {
    const avg = (count: number, total: number) => (count > 0 ? total / count : 0);
    return {
      pending: this.pending.size,
      completed: this.completedParses,
      avgParseMs: avg(this.completedParses, this.totalParseMs),
      maxParseMs: this.maxParseMs,
      workerParses: this.workerParses,
      avgWorkerParseMs: avg(this.workerParses, this.workerTotalMs),
      maxWorkerParseMs: this.workerMaxMs,
      fallbackParses: this.fallbackParses,
      avgFallbackParseMs: avg(this.fallbackParses, this.fallbackTotalMs),
      maxFallbackParseMs: this.fallbackMaxMs,
      fallbackActive: this.fallbackActive,
      workerFailures: this.workerFailures,
    };
  }

  constructor(options: MarkdownWorkerClientOptions = {}) {
    this.createWorker = options.createWorker;
    this.parseInProcess = options.parseInProcess;
  }

  parse(text: string, pathCtx?: ChatPathLinkifyContext): MarkdownParseHandle {
    if (this.disposed) {
      return { promise: Promise.resolve(undefined), cancel: () => {} };
    }
    const id = this.nextId;
    this.nextId += 1;
    const promise = new Promise<MarkdownParseResult | undefined>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, startedAt: nowMs(), text, pathCtx, state: "queued" });
    });
    const cancel = () => {
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      entry.resolve(undefined);
      if (this.activeRequestId !== id) return;
      if (entry.state === "fallback") {
        // Synchronous fallback work cannot be interrupted. Keep the queue
        // parked until its promise settles instead of starting a second parse.
        return;
      }
      this.activeRequestId = null;
      this.resetWorker();
      void this.pump();
    };
    void this.pump();
    return { promise, cancel };
  }

  private async pump(): Promise<void> {
    if (this.disposed || this.activeRequestId !== null || this.pumping) return;
    this.pumping = true;
    try {
      const next = Array.from(this.pending.entries()).find(([, entry]) => entry.state === "queued");
      if (!next) return;
      const [id, entry] = next;
      const worker = typeof Worker === "undefined" ? null : await this.ensureWorker();
      if (this.disposed || !this.pending.has(id) || this.activeRequestId !== null) return;
      this.activeRequestId = id;
      if (!worker) {
        entry.state = "fallback";
        this.parseInProcessAsync(id, entry.text, entry.pathCtx);
        return;
      }
      entry.state = "worker";
      entry.postedAt = nowMs();
      worker.postMessage({ id, text: entry.text, pathCtx: entry.pathCtx } satisfies MarkdownParseRequest);
    } finally {
      this.pumping = false;
      if (
        !this.disposed
        && this.activeRequestId === null
        && Array.from(this.pending.values()).some((entry) => entry.state === "queued")
      ) {
        queueMicrotask(() => void this.pump());
      }
    }
  }

  // noteSettled records one completed parse attempt (success or error) for
  // the latency counters; cancellations resolve with undefined and skip it.
  // `path` splits the worker (off-main-thread) and fallback (synchronous
  // main-thread) counters; `durationMs` overrides the default queue-inclusive
  // latency when a tighter window was measured (postedAt for the worker, the
  // in-process run window for the fallback).
  private noteSettled(entry: PendingRequest, path: "worker" | "fallback", durationMs?: number): void {
    const duration = Math.max(0, durationMs ?? nowMs() - entry.startedAt);
    this.completedParses += 1;
    this.totalParseMs += duration;
    if (duration > this.maxParseMs) this.maxParseMs = duration;
    if (path === "worker") {
      this.workerParses += 1;
      this.workerTotalMs += duration;
      if (duration > this.workerMaxMs) this.workerMaxMs = duration;
    } else {
      this.fallbackParses += 1;
      this.fallbackTotalMs += duration;
      if (duration > this.fallbackMaxMs) this.fallbackMaxMs = duration;
    }
  }

  private parseInProcessAsync(id: number, text: string, pathCtx?: ChatPathLinkifyContext): void {
    // Async even though the work is synchronous: callers attach handlers
    // after parse() returns, and main-thread fallback should never parse
    // synchronously inside a React effect commit.
    this.fallbackActive = true;
    const injected = this.parseInProcess;
    const run = injected
      ? async () => injected(text, pathCtx)
      : () => loadPipeline().then((pipeline) => pipeline.parseMarkdown(text, pathCtx));
    // The first fallback parse may spend its window waiting on the dynamic
    // pipeline import (async, does not block the loop); every subsequent one
    // is a synchronous main-thread parse. Either way the measured window is
    // what the parse latency counters report.
    const runStartedAt = nowMs();
    void run().then(
      (result) => {
        const entry = this.pending.get(id);
        if (entry) {
          this.pending.delete(id);
          this.noteSettled(entry, "fallback", nowMs() - runStartedAt);
          noteFallbackParseBreadcrumb(nowMs() - runStartedAt);
          if (this.disposed) entry.resolve(undefined);
          else entry.resolve(result);
        }
        if (this.activeRequestId === id) this.activeRequestId = null;
        this.fallbackActive = false;
        void this.pump();
      },
      (error: unknown) => {
        const entry = this.pending.get(id);
        if (entry) {
          this.pending.delete(id);
          this.noteSettled(entry, "fallback", nowMs() - runStartedAt);
          noteFallbackParseBreadcrumb(nowMs() - runStartedAt);
          entry.reject(error instanceof Error ? error : new Error(String(error)));
        }
        if (this.activeRequestId === id) this.activeRequestId = null;
        this.fallbackActive = false;
        void this.pump();
      },
    );
  }

  private ensureWorker(): Promise<MarkdownWorkerLike | null> {
    if (this.worker) return Promise.resolve(this.worker);
    if (!this.workerPromise) {
      const create = this.createWorker ?? createInlineMarkdownWorker;
      this.workerPromise = create()
        .then((worker) => {
          if (this.disposed) {
            worker.terminate();
            return null;
          }
          worker.onmessage = (event) => this.handleMessage(event.data);
          worker.onerror = () => this.handleWorkerFailure();
          this.worker = worker;
          return worker;
        })
        .catch(() => null);
    }
    return this.workerPromise;
  }

  private handleMessage(response: MarkdownParseResponse): void {
    const entry = this.pending.get(response.id);
    if (!entry) return; // cancelled or superseded — drop the stale response
    this.pending.delete(response.id);
    if (this.activeRequestId === response.id) this.activeRequestId = null;
    this.noteSettled(entry, "worker", entry.postedAt !== undefined ? nowMs() - entry.postedAt : undefined);
    this.fallbackActive = false;
    if (response.error !== undefined) {
      entry.reject(new Error(response.error));
    } else {
      entry.resolve(response.result ?? { blocks: [], selectionText: "", selectionRevision: 0 });
    }
    void this.pump();
  }

  private resetWorker(): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
    }
    this.worker = null;
    this.workerPromise = null;
  }

  /** A broken worker must not wedge parsing: reject pending work so callers
   *  fall back to their main-thread path, and reset so the next parse retries
   *  worker creation (or falls back in-process when Worker is gone). */
  private handleWorkerFailure(): void {
    this.resetWorker();
    this.activeRequestId = null;
    this.workerFailures += 1;
    const stranded = Array.from(this.pending.values());
    this.pending.clear();
    for (const entry of stranded) entry.reject(new Error("markdown worker failed"));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resetWorker();
    this.activeRequestId = null;
    for (const entry of this.pending.values()) entry.resolve(undefined);
    this.pending.clear();
  }
}

async function createInlineMarkdownWorker(): Promise<MarkdownWorkerLike> {
  const { default: MarkdownWorkerConstructor } = await import("../components/markdown.worker?worker&inline");
  return new MarkdownWorkerConstructor();
}

// ── app-level singleton with lease counting ──────────────────────────────────
// The worker is cheap while idle but it IS a thread: Transcript surfaces lease
// it while mounted and the last release terminates it, so closing every
// session/tab surface releases the parser thread. parse() re-spawns lazily.

let singleton: MarkdownWorkerClient | null = null;
let leases = 0;

export function getMarkdownWorkerClient(): MarkdownWorkerClient {
  if (!singleton) singleton = new MarkdownWorkerClient();
  return singleton;
}

export function acquireMarkdownWorkerClient(): MarkdownWorkerClient {
  leases += 1;
  return getMarkdownWorkerClient();
}

export function releaseMarkdownWorkerClient(): void {
  if (leases === 0) return;
  leases -= 1;
  if (leases === 0 && singleton) {
    singleton.dispose();
    singleton = null;
  }
}

/** Explicit teardown (app shutdown, tests). Settles all pending requests. */
export function disposeMarkdownWorkerClient(): void {
  leases = 0;
  singleton?.dispose();
  singleton = null;
}

/** Test hook: install a fake/spied client as the app singleton. */
export function setMarkdownWorkerClientForTest(client: MarkdownWorkerClient | null): void {
  singleton?.dispose();
  singleton = client;
  leases = 0;
}

// Diagnostics provider: lets crash.ts/bench read worker counters without an
// eager import of this lazy-chunk module.
registerMarkdownWorkerDiagnostics(() =>
  singleton?.stats() ?? {
    pending: 0,
    completed: 0,
    avgParseMs: 0,
    maxParseMs: 0,
    workerParses: 0,
    avgWorkerParseMs: 0,
    maxWorkerParseMs: 0,
    fallbackParses: 0,
    avgFallbackParseMs: 0,
    maxFallbackParseMs: 0,
    fallbackActive: false,
    workerFailures: 0,
  },
);
