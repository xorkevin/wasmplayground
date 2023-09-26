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

  const reply = (msg) => {
    PORT.postMessage(msg, msg.ret ? [msg.ret.buffer] : []);
    Atomics.add(SHARED_BUFFER, WORKER_IDX.RCV, 1);
    Atomics.notify(SHARED_BUFFER, WORKER_IDX.RCV);
  };

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

      if (!msg.message) {
        reply({
          modTimeNS: 0,
          fnTimeNS: 0,
          ret: undefined,
          reterr: new Error('Invalid message'),
        });
        continue;
      }

      const {id, mod, fnname, arg} = msg.message;

      try {
        if (!id || typeof id !== 'string') {
          throw new Error('Must provide mod id');
        }
        if (!mod) {
          throw new Error('Must provide wasm mod');
        }
        if (!fnname || typeof fnname !== 'string') {
          throw new Error('Must provide fn name');
        }
        if (!(arg instanceof Uint8Array)) {
          throw new Error('Must provide fn arg');
        }
      } catch (err) {
        reply({
          modTimeNS: 0,
          fnTimeNS: 0,
          ret: undefined,
          reterr: new Error('Invalid message'),
        });
        continue;
      }

      const modStart = process.hrtime.bigint();
      if (id !== MOD.id) {
        try {
          const nextMod = {
            id,
            instance: new wasmmod.WasmModInstance(mod),
          };
          await nextMod.instance.init();
          MOD = nextMod;
        } catch (err) {
          const modEnd = process.hrtime.bigint();
          reply({
            modTimeNS: modEnd - modStart,
            fnTimeNS: 0,
            ret: undefined,
            reterr: new Error('Failed to instantiate module', {cause: err}),
          });
          continue;
        }
      }

      let ret = null;
      let reterr = null;
      const fnStart = process.hrtime.bigint();
      try {
        ret = MOD.instance.callBytesFn(fnname, arg);
      } catch (err) {
        MOD = EMPTY_MOD;
        reterr = err;
      }
      const fnEnd = process.hrtime.bigint();
      const modEnd = process.hrtime.bigint();
      reply({
        modTimeNS: modEnd - modStart,
        fnTimeNS: fnEnd - fnStart,
        ret,
        reterr,
      });
    }
  }
}
