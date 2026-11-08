import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPollingSource } from '../src/data/polling.js';
import { STALE_AFTER } from '../src/data/telemetry.js';

const profile = { endpoints: [], regions: [] };
const response = () => ({ ok: true, json: async () => ({ latency: 12, throughput: 50 }) });

describe('polling source freshness and lifecycle', () => {
  let source;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    source?.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('marks an unavailable feed stale and clears staleness on recovery', async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    const store = { setStale: vi.fn() }, push = vi.fn();
    source = createPollingSource({ profile, url: '/feed' });
    source.start(push, store);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.setStale).toHaveBeenLastCalledWith(false);
    fetch.mockRejectedValue(new Error('offline'));
    await vi.advanceTimersByTimeAsync((STALE_AFTER + 1) * 1000);
    expect(store.setStale).toHaveBeenLastCalledWith(true);
    expect(push).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(response());
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.setStale).toHaveBeenLastCalledWith(false);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('rejects HTTP errors even if their bodies look like telemetry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ...response(), ok: false, status: 503 }));
    const push = vi.fn(), store = { setStale: vi.fn() };
    source = createPollingSource({ profile, url: '/feed' });
    source.start(push, store);
    await vi.advanceTimersByTimeAsync(0);
    expect(push).not.toHaveBeenCalled();
    expect(store.setStale).toHaveBeenLastCalledWith(true);
  });

  it('does not overlap requests, aborts a hung fetch, and retries', async () => {
    const fetch = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    vi.stubGlobal('fetch', fetch);
    source = createPollingSource({ profile, url: '/feed' });
    source.start(vi.fn(), { setStale: vi.fn() });
    await vi.advanceTimersByTimeAsync(7000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('ignores a response from a stopped generation, even after restarting', async () => {
    let complete;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise((r) => { complete = r; })).mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    const oldPush = vi.fn(), push = vi.fn();
    source = createPollingSource({ profile, url: '/feed' });
    source.start(oldPush);
    source.stop();
    source.start(push);
    complete(response());
    await vi.advanceTimersByTimeAsync(0);
    expect(oldPush).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(1);
  });
});
