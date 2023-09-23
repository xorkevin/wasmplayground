import path from 'node:path';
import {Worker, MessageChannel} from 'node:worker_threads';

const defaultOptions = Object.freeze({
  maxThreads: 8,
});

const ATOMIC_TIMED_OUT = 'timed-out';

const WORKER_IDX = Object.freeze({
  READY: 0,
  SEND: 1,
  RCV: 2,
});

class WasmWorker {
  #workers;
  #worker;
  #port;
  #sharedBuffer;

  constructor(workers) {
    this.#workers = workers;
    const {port1, port2} = new MessageChannel();
    this.#port = port1;
    this.#sharedBuffer = new Int32Array(
      new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT),
    );
    this.#worker = new Worker(path.resolve(__dirname, 'wasmpoolworker.js'), {
      workerData: {sharedBuffer: this.#sharedBuffer, port: port2},
      transferList: [port2],
    });
    this.isExited = false;
    this.exited = new Promise((resolve) => {
      this.#worker.once('exit', () => {
        this.#port.close();
        this.isExited = true;
        this.#workers.delete(w);
        resolve();
      });
    });
    this.#workers.add(w);
    this.isReady = false;
    w.ready = new Promise(async (resolve) => {
      while (true) {
        const status = Atomics.load(this.#sharedBuffer, WORKER_IDX.READY);
        if (status !== 0) {
          break;
        }
        const res = Atomics.waitAsync(this.#sharedBuffer, WORKER_IDX.READY, 0);
        if (res.async) {
          await res.value;
        }
      }
      this.isReady = true;
      resolve();
    });
  }

  terminate() {
    return this.#worker.terminate();
  }
}

const POOL_IDX = Object.freeze({
  SEM: 0,
});

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
    Atomics.store(this.#sharedBuffer, POOL_IDX.SEM, this.#options.maxThreads);
    this.#isClosing = false;
  }

  async getWorker(timeout_ms = 0) {
    while (true) {
      if (this.#isClosing) {
        throw new Error('pool closing');
      }
      const remaining = Atomics.load(this.#sharedBuffer, POOL_IDX.SEM);
      if (remaining > 0) {
        break;
      }
      const res =
        timeout_ms > 0
          ? Atomics.waitAsync(
              this.#sharedBuffer,
              POOL_IDX.SEM,
              remaining,
              timeout_ms,
            )
          : Atomics.waitAsync(this.#sharedBuffer, POOL_IDX.SEM, remaining);
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
        Atomics.add(this.#sharedBuffer, POOL_IDX.SEM, -1);
        return w;
      }
    }
    const w = new WasmWorker(this.#workers);
    Atomics.add(this.#sharedBuffer, POOL_IDX.SEM, -1);
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
    const old = Atomics.add(this.#sharedBuffer, POOL_IDX.SEM, 1);
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
      Atomics.notify(this.#sharedBuffer, POOL_IDX.SEM, 1);
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
    const old = Atomics.add(this.#sharedBuffer, POOL_IDX.SEM, delta);
    if (delta > 0) {
      if (old + 1 > 0) {
        Atomics.notify(
          this.#sharedBuffer,
          POOL_IDX.SEM,
          Math.min(old + 1, delta),
        );
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
    Atomics.notify(this.#sharedBuffer, POOL_IDX.SEM);
    while (this.#pool.length > 0) {
      const w = this.#getWorkerFromPool();
      if (w) {
        w.terminate();
      }
    }
  }
}
