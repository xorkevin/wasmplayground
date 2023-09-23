import * as worker from 'node:worker_threads';
import * as process from 'node:process';
import * as wasmmod from './wasmmod.js';

const WORKER_IDX = Object.freeze({
  READY: 0,
  SEND: 1,
  RCV: 2,
});

const {sharedBuffer: SHARED_BUFFER, port: PORT} = worker.workerData;

Atomics.store(SHARED_BUFFER, WORKER_IDX.READY, 1);
Atomics.notify(SHARED_BUFFER, WORKER_IDX.READY);

let MOD = {
  id: null,
  instance: null,
};

while (true) {
  while (true) {
    const status = Atomics.load(SHARED_BUFFER, WORKER_IDX.SEND);
    if (status > 0) {
      break;
    }
    Atomics.wait(SHARED_BUFFER, WORKER_IDX.SEND, status);
  }
  while (true) {
    const msg = worker.receiveMessageOnPort(PORT);
    if (!msg) {
      break;
    }
    Atomics.add(SHARED_BUFFER, WORKER_IDX.SEND, -1);
    const {id, mod, fnname, arg} = msg;
    if (id !== MOD.id) {
      MOD = {
        id,
        instance: new wasmmod.WasmModInstance(mod),
      };
      await MOD.instance.init();
    }
    const start = process.hrtime.bigint();
    const ret = MOD.instance.callStrFn(fnname, arg);
    const end = process.hrtime.bigint();
    const deltaMS = Number((end - start) / 1000000n);
    PORT.postMessage({deltaMS, ret});
    Atomics.add(SHARED_BUFFER, WORKER_IDX.RCV, 1);
    Atomics.notify(SHARED_BUFFER, WORKER_IDX.RCV);
  }
}
