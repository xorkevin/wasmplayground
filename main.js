import process from 'node:process';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

import * as pool from './wasmpool.js';
import assert from 'node:assert';

const buf = await fs.readFile('./bin/wasmplayground.wasm');
const mod = await WebAssembly.compile(buf);

const wasmPool = new pool.WasmPool({maxThreads: 16});
process.on('SIGTERM', () => {
  wasmPool.close();
});
process.on('SIGINT', () => {
  wasmPool.close();
});

try {
  await wasmPool.primeThreads();

  const modid = crypto.createHash('blake2b512').update(buf).digest('base64url');
  try {
    const res = await wasmPool.withWorker(async (worker) => {
      const greet1 = await worker.callJSONFn(
        modid,
        mod,
        'greet',
        {name: 'world'},
        {
          timeoutMS: 25,
        },
      );
      const greet2 = await worker.callJSONFn(
        modid,
        mod,
        'greet',
        {name: 'kevin'},
        {
          timeoutMS: 25,
        },
      );
      return {greet1, greet2};
    });
    console.log('res 1', res);
  } catch (err) {
    console.log('res 1 err', err);
  }
  try {
    const res = await wasmPool.withWorker(async (worker) => {
      return worker.callJSONFn(
        modid,
        mod,
        'long_greet',
        {name: 'world'},
        {
          timeoutMS: 25,
        },
      );
    });
    console.log('res 2', res);
  } catch (err) {
    console.log('res 2 err', err);
  }
  try {
    const res = await wasmPool.withWorker(async (worker) => {
      return worker.callJSONFn(
        modid,
        mod,
        'greet',
        {name: 'world'},
        {
          timeoutMS: 25,
        },
      );
    });
    console.log('res 3', res);
  } catch (err) {
    console.log('res 3 err', err);
  }
  try {
    const res = await wasmPool.withWorker(async (worker) => {
      return worker.callJSONFn(
        modid,
        mod,
        'throw_greet',
        {name: 'world'},
        {
          timeoutMS: 25,
        },
      );
    });
    console.log('res 4', res);
  } catch (err) {
    console.log('res 4 err', err);
  }
  try {
    const res = await wasmPool.withWorker(async (worker) => {
      return worker.callJSONFn(
        modid,
        mod,
        'greet',
        {name: 'world'},
        {
          timeoutMS: 25,
        },
      );
    });
    console.log('res 5', res);
  } catch (err) {
    console.log('res 5 err', err);
  }
  try {
    const res = await wasmPool.withWorker(async (worker) => {
      return worker.callJSONFn(
        modid,
        mod,
        'panic_greet',
        {name: 'world'},
        {
          timeoutMS: 25,
        },
      );
    });
    console.log('res 6', res);
  } catch (err) {
    console.log('res 6 err', err);
  }
  try {
    const res = await wasmPool.withWorker(async (worker) => {
      return worker.callJSONFn(
        modid,
        mod,
        'greet',
        {name: 'world'},
        {
          timeoutMS: 25,
        },
      );
    });
    console.log('res 7', res);
  } catch (err) {
    console.log('res 7 err', err);
  }
  try {
    const res = await wasmPool.withWorker(async (worker) => {
      return worker.callJSONFn(
        'bogus mod id',
        'bogus mod',
        'bogus fn',
        {name: 'world'},
        {
          timeoutMS: 25,
        },
      );
    });
    console.log('res 8', res);
  } catch (err) {
    console.log('res 8 err', err);
  }
  try {
    const res = await wasmPool.withWorker(async (worker) => {
      return worker.callJSONFn(
        modid,
        mod,
        'greet',
        {name: 'world'},
        {
          timeoutMS: 25,
        },
      );
    });
    console.log('res 9', res);
  } catch (err) {
    console.log('res 9 err', err);
  }

  const fnnames = [
    'greet',
    'greet',
    'greet',
    'long_greet',
    'throw_greet',
    'panic_greet',
  ];

  let compileTotalTime = 0n;
  let modTotalTime = 0n;
  let fnTotalTime = 0n;
  const resultsStart = process.hrtime.bigint();
  const results = await Promise.allSettled(
    new Array(1000).fill(0).map(async (_value, i) => {
      const res = await wasmPool.withWorker(async (worker) => {
        const compileStart = process.hrtime.bigint();
        const mod = await WebAssembly.compile(buf);
        const compileEnd = process.hrtime.bigint();
        compileTotalTime += compileEnd - compileStart;
        const fnname = fnnames[i % fnnames.length];
        return worker.callJSONFn(
          'id_' + i,
          mod,
          fnname,
          {name: 'world'},
          {
            timeoutMS: 25,
          },
        );
      });
      modTotalTime += res.modTimeNS;
      fnTotalTime += res.fnTimeNS;
      if (res.reterr) {
        throw res.reterr;
      }
      assert.deepStrictEqual(res.ret, {message: 'Hello, world'});
    }),
  );
  const resultsEnd = process.hrtime.bigint();
  console.log({
    results: results.reduce(
      (acc, v) => {
        if (v.status === 'fulfilled') {
          acc.successes++;
        } else {
          acc.fails++;
        }
        return acc;
      },
      {successes: 0, fails: 0},
    ),
    compileAvgTime: Number(compileTotalTime) / 1_000_000 + ' us',
    modAvgTime: Number(modTotalTime) / 1_000_000 + ' us',
    fnAvgTime: Number(fnTotalTime) / 1_000_000 + ' us',
    totalTime: Number(resultsEnd - resultsStart) / 1_000_000 + ' ms',
  });
} finally {
  wasmPool.close();
}
