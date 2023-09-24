import worker from 'node:worker_threads';
import process from 'node:process';

import * as wasmmod from './wasmmod.js';

const WORKER_IDX = Object.freeze({
  READY: 0,
  SEND: 1,
  RCV: 2,
});

const EMPTY_MOD = Object.freeze({
  id: null,
  instance: null,
});

if (!worker.isMainThread) {
  const {sharedBuffer: SHARED_BUFFER, port: PORT} = worker.workerData;

  Atomics.store(SHARED_BUFFER, WORKER_IDX.READY, 1);
  Atomics.notify(SHARED_BUFFER, WORKER_IDX.READY);

  let MOD = EMPTY_MOD;

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
      if (msg.message) {
        const {id, mod, fnname, arg} = msg.message;
        if (id !== MOD.id) {
          MOD = {
            id,
            instance: new wasmmod.WasmModInstance(mod),
          };
          await MOD.instance.init();
        }
        const start = process.hrtime.bigint();
        let ret = null;
        let reterr = null;
        try {
          ret = MOD.instance.callStrFn(fnname, arg);
        } catch (err) {
          MOD = EMPTY_MOD;
          reterr = err;
        }
        const end = process.hrtime.bigint();
        const deltaNS = end - start;
        PORT.postMessage({deltaNS, ret, reterr});
      } else {
        PORT.postMessage({
          deltaNS: 0,
          ret: null,
          reterr: new Error('Invalid message'),
        });
      }
      Atomics.add(SHARED_BUFFER, WORKER_IDX.RCV, 1);
      Atomics.notify(SHARED_BUFFER, WORKER_IDX.RCV);
    }
  }
}
