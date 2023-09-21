const defaultOptions = Object.freeze({
  minThreads: 1,
  maxThreads: 8,
});

export class WasmPool {
  constructor(options) {
    this.options = Object.assign({}, defaultOptions, options);
    this.workers = new Set();
    this.pool = [];
  }

  getWorker() {
    if (this.pool.length > 0) {
      return this.pool.shift();
    }
    // TODO check maxThreads and Atomic.wait
    // TODO construct worker
  }

  putWorker(worker) {
    if (this.workers.length >= this.options.maxThreads) {
      return;
    }
    this.pool.push(worker);
    // TODO Atomic.notify worker has been added
  }
}
