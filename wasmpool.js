import path from 'node:path';
import {Worker, MessageChannel} from 'node:worker_threads';

const defaultOptions = Object.freeze({
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
        this.#port.close();
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

  terminate() {
    return this.#worker.terminate();
  }
}

export class WasmPool {
  #options;
  #workers;
  #pool;
  #sharedBuffer;
  #isClosing;

  constructor(options) {
    this.#options = Object.assign({}, defaultOptions, options);
    if (options.maxThreads < 0) {
      throw new Error('max threads must be positive');
    }
    this.#workers = new Set();
    this.#pool = [];
    this.#sharedBuffer = new Int32Array(
      new SharedArrayBuffer(1 * Int32Array.BYTES_PER_ELEMENT),
    );
    Atomics.store(this.#sharedBuffer, 0, this.#options.maxThreads);
    this.#isClosing = false;
  }

  async getWorker(timeout_ms = 0) {
    while (true) {
      if (this.#isClosing) {
        throw new Error('pool closing');
      }
      const remaining = Atomics.load(this.#sharedBuffer, 0);
      if (remaining > 0) {
        break;
      }
      const res =
        timeout_ms > 0
          ? Atomics.waitAsync(this.#sharedBuffer, 0, remaining, timeout_ms)
          : Atomics.waitAsync(this.#sharedBuffer, 0, remaining);
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
        Atomics.add(this.#sharedBuffer, 0, -1);
        return w;
      }
    }
    const w = new WasmWorker(this.#workers);
    Atomics.add(this.#sharedBuffer, 0, -1);
    return w;
  }

  #getWorkerFromPool() {
    while (this.#pool.length > 0) {
      const candidate = this.#pool.shift();
      if (!candidate.isExited) {
        return candidate;
      }
    }
    return null;
  }

  putWorker(worker) {
    const old = Atomics.add(this.#sharedBuffer, 0, 1);
    if (this.#isClosing) {
      if (!worker.isExited) {
        worker.terminate();
      }
      return;
    }
    if (old + 1 > 0) {
      if (!worker.isExited) {
        this.#pool.push(worker);
      }
      Atomics.notify(this.#sharedBuffer, 0, 1);
    } else {
      if (!worker.isExited) {
        worker.terminate();
      }
    }
  }

  setMaxThreads(num) {
    if (num < 0) {
      throw new Error('min threads must be positive');
    }
    const delta = num - this.#options.maxThreads;
    this.#options.maxThreads = num;
    if (delta === 0) {
      return;
    }
    const old = Atomics.add(this.#sharedBuffer, 0, delta);
    if (delta > 0) {
      if (old + 1 > 0) {
        Atomics.notify(this.#sharedBuffer, 0, Math.min(old + 1, delta));
      }
      return;
    }
    const decr = this.#workers.size - this.#options.maxThreads;
    if (decr <= 0) {
      return;
    }
    for (let i = 0; i < decr; i++) {
      const w = this.#getWorkerFromPool();
      if (!w) {
        break;
      }
      w.terminate();
    }
  }

  close() {
    this.#isClosing = true;
    // notify all waiters
    Atomics.notify(this.#sharedBuffer, 0);
    while (this.#pool.length > 0) {
      const w = this.#getWorkerFromPool();
      if (w) {
        w.terminate();
      }
    }
  }
}
