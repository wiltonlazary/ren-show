// Bridges from JavaScript's own async forms to rrx-core tasks: a promise-returning
// function becomes a `$task`, an async iterable becomes a `$stream`. Each run gets
// an AbortSignal that aborts when the input changes or the owner stops, so a
// superseded or disposed request is cancelled and its late result ignored.

import { $task, $stream } from 'rrx-core';

/**
 * A task whose work is an async function of its input.
 * @template I, T
 * @param {import('rrx-core').Graph} root
 * @param {() => I} source
 * @param {(input: I, signal: AbortSignal) => Promise<T>} work
 */
export function Async(root, source, work) {
  return $task(root, source, (/** @type {I} */ input, complete) => {
    const controller = new AbortController();
    work(input, controller.signal).then(
      value => {
        if (!controller.signal.aborted) complete({ ok: true, value });
      },
      error => {
        if (!controller.signal.aborted) complete({ ok: false, error });
      },
    );
    return () => controller.abort(new DOMException('superseded', 'AbortError'));
  });
}

/**
 * A stream fed by an async iterable (an async generator): each value is
 * shown as it arrives; the last one is the result.
 * @template I, T
 * @param {import('rrx-core').Graph} root
 * @param {() => I} source
 * @param {(input: I, signal: AbortSignal) => AsyncIterable<T>} produce
 */
export function Each(root, source, produce) {
  return $stream(root, source, (/** @type {I} */ input, next, complete) => {
    const controller = new AbortController();
    (async () => {
      /** @type {T | undefined} */
      let last;
      try {
        for await (const value of produce(input, controller.signal)) {
          if (controller.signal.aborted) return;
          last = value;
          next(value);
        }
        if (!controller.signal.aborted) complete({ ok: true, value: /** @type {T} */ (last) });
      } catch (error) {
        if (!controller.signal.aborted) complete({ ok: false, error });
      }
    })();
    return () => controller.abort();
  });
}

/**
 * A simulated request's latency: resolves after `ms` on the environment's
 * clock (`later`), or rejects with the signal's reason when it aborts.
 * @param {(ms: number, fn: () => void) => () => void} later
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export const latency = (later, ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const cancel = later(ms, () => resolve()); // timer: feature, a demo's simulated latency
    signal?.addEventListener('abort', () => {
      cancel();
      reject(signal.reason);
    }, { once: true });
  });
