import path from 'node:path';
import {Worker, MessageChannel} from 'node:worker_threads';

const defaultOptions = Object.freeze({
  minThreads: 1,
  maxThreads: 8,
});

const ATOMIC_TIMED_OUT = 'timed-out';

class WasmWorker {
  #workers;
  #worker;
  #port;
  #sharedBuffer;

  constructor(workers) {
    this.#workers = workers;
    this.#worker = new Worker(path.resolve(__dirname, 'wasmpoolworker.js'));
    const {port1, port2} = new MessageChannel();
    this.#port = port1;
    this.#sharedBuffer = new Int32Array(
      new SharedArrayBuffer(1 * Int32Array.BYTES_PER_ELEMENT),
    );
    this.isExited = false;
    this.exited = new Promise((resolve) => {
      this.#worker.on('exit', () => {
        this.isExited = true;
        this.#workers.delete(w);
        resolve();
      });
    });
    this.#workers.add(w);
    this.isReady = false;
    w.ready = new Promise((resolve) => {
      this.#worker.on('message', () => {
        this.isReady = true;
        resolve();
      });
    });
    this.#worker.postMessage({sharedBuffer: this.#sharedBuffer, port: port2}, [
      port2,
    ]);
  }
}

export class WasmPool {
  constructor(options) {
    this.options = Object.assign({}, defaultOptions, options);
    this.workers = new Set();
    this.pool = [];
    this.sharedBuffer = new Int32Array(
      new SharedArrayBuffer(1 * Int32Array.BYTES_PER_ELEMENT),
    );
    Atomics.store(this.sharedBuffer, 0, this.options.maxThreads);
  }

  async getWorker(timeout_ms = 0) {
    while (true) {
      const remaining = Atomics.load(this.sharedBuffer, 0);
      if (remaining < 0) {
        throw new Error('Invariant violation: less than 0 remaining');
      }
      if (remaining > 0) {
        break;
      }
      const res =
        timeout_ms === 0
          ? Atomics.waitAsync(this.sharedBuffer, 0, 0)
          : Atomics.waitAsync(this.sharedBuffer, 0, 0, timeout_ms);
      if (!res.async) {
        if (res.value === ATOMIC_TIMED_OUT) {
          throw new Error('timed out');
        }
      } else {
        if ((await res.value) === ATOMIC_TIMED_OUT) {
          throw new Error('timed out');
        }
      }
    }
    {
      const w = this.#getWorkerFromPool();
      if (w) {
        Atomics.add(this.sharedBuffer, 0, -1);
        return w;
      }
    }
    const w = new WasmWorker(this.workers);
    Atomics.add(this.sharedBuffer, 0, -1);
    return w;
  }

  #getWorkerFromPool() {
    while (this.pool.length > 0) {
      const candidate = this.pool.shift();
      if (!candidate.isExited) {
        return candidate;
      }
    }
    return null;
  }

  putWorker(worker) {
    Atomics.add(this.sharedBuffer, 0, 1);
    if (!worker.isExited) {
      this.pool.push(worker);
    }
    Atomics.notify(this.sharedBuffer, 0, 1);
  }
}
