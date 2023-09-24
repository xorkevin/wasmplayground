import {
  Worker,
  MessageChannel,
  receiveMessageOnPort,
} from 'node:worker_threads';

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
  #isExited;
  #exited;
  #isReady;
  #ready;
  #isTerminating;
  #lastError;

  constructor(workers) {
    this.#workers = workers;
    const {port1, port2} = new MessageChannel();
    this.#port = port1;
    this.#sharedBuffer = new Int32Array(
      new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT),
    );
    this.#worker = new Worker(new URL('./wasmpoolworker.js', import.meta.url), {
      workerData: {sharedBuffer: this.#sharedBuffer, port: port2},
      transferList: [port2],
    });
    this.#worker.on('error', (err) => {
      console.log('error from worker', err);
      this.#lastError = err;
    });
    this.#isExited = false;
    this.#exited = new Promise((resolve) => {
      this.#worker.once('exit', () => {
        this.#port.close();
        this.#isTerminating = true;
        this.#isExited = true;
        Atomics.notify(this.#sharedBuffer, WORKER_IDX.READY);
        Atomics.notify(this.#sharedBuffer, WORKER_IDX.RCV);
        this.#workers.delete(this);
        resolve();
      });
    });
    this.#workers.add(this);
    this.#isReady = false;
    this.#ready = new Promise(async (resolve) => {
      while (true) {
        if (this.isTerminating) {
          if (this.#lastError) {
            throw new Error('worker terminating', {cause: this.#lastError});
          }
          throw new Error('worker terminating');
        }
        const status = Atomics.load(this.#sharedBuffer, WORKER_IDX.READY);
        if (status !== 0) {
          break;
        }
        const res = Atomics.waitAsync(this.#sharedBuffer, WORKER_IDX.READY, 0);
        if (res.async) {
          await res.value;
        }
      }
      this.#isReady = true;
      resolve();
    });
  }

  get isExited() {
    return this.#isExited;
  }

  get exited() {
    return this.#exited;
  }

  get isReady() {
    return this.#isReady;
  }

  get ready() {
    return this.#ready;
  }

  get isTerminating() {
    return this.#isTerminating;
  }

  async callStrFn(id, mod, fnname, arg, {timeoutMS = 0} = {}) {
    if (this.isTerminating) {
      if (this.#lastError) {
        throw new Error('worker terminating', {cause: this.#lastError});
      }
      throw new Error('worker terminating');
    }
    this.#port.postMessage({id, mod, fnname, arg});
    Atomics.add(this.#sharedBuffer, WORKER_IDX.SEND, 1);
    Atomics.notify(this.#sharedBuffer, WORKER_IDX.SEND);
    while (true) {
      if (this.isTerminating) {
        if (this.#lastError) {
          throw new Error('worker terminating', {cause: this.#lastError});
        }
        throw new Error('worker terminating');
      }
      const status = Atomics.load(this.#sharedBuffer, WORKER_IDX.RCV);
      if (status > 0) {
        break;
      }
      const res =
        timeoutMS > 0
          ? Atomics.waitAsync(
              this.#sharedBuffer,
              WORKER_IDX.RCV,
              status,
              timeoutMS,
            )
          : Atomics.waitAsync(this.#sharedBuffer, WORKER_IDX.RCV, status);
      if (!res.async) {
        if (res.value === ATOMIC_TIMED_OUT) {
          this.terminate();
          throw new Error('timed out');
        }
      } else {
        if ((await res.value) === ATOMIC_TIMED_OUT) {
          this.terminate();
          throw new Error('timed out');
        }
      }
    }
    const msg = receiveMessageOnPort(this.#port);
    Atomics.add(this.#sharedBuffer, WORKER_IDX.RCV, -1);
    return msg && msg.message;
  }

  terminate() {
    if (this.#isTerminating) {
      return;
    }
    this.#isTerminating = true;
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
    if (this.#options.maxThreads < 0) {
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

  async getWorker(timeoutMS = 0) {
    while (true) {
      if (this.#isClosing) {
        throw new Error('pool closing');
      }
      const remaining = Atomics.load(this.#sharedBuffer, POOL_IDX.SEM);
      if (remaining > 0) {
        break;
      }
      const res =
        timeoutMS > 0
          ? Atomics.waitAsync(
              this.#sharedBuffer,
              POOL_IDX.SEM,
              remaining,
              timeoutMS,
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
      if (!candidate.isTerminating) {
        return candidate;
      }
    }
    return null;
  }

  putWorker(worker) {
    const old = Atomics.add(this.#sharedBuffer, POOL_IDX.SEM, 1);
    if (this.#isClosing) {
      worker.terminate();
      return;
    }
    if (old + 1 > 0) {
      if (!worker.isTerminating) {
        this.#pool.push(worker);
      }
      Atomics.notify(this.#sharedBuffer, POOL_IDX.SEM, 1);
    } else {
      worker.terminate();
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
    if (this.#isClosing) {
      return;
    }

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

  async withWorker(f) {
    const worker = await this.getWorker();
    try {
      await worker.ready;
      // wait for f to finish
      const res = await f(worker);
      return res;
    } finally {
      this.putWorker(worker);
    }
  }
}
