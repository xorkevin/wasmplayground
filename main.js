import process from 'node:process';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

import * as pool from './wasmpool.js';

const buf = await fs.readFile('./bin/wasmplayground.wasm');
const mod = await WebAssembly.compile(buf);

const wasmPool = new pool.WasmPool();
process.on('SIGTERM', () => {
  wasmPool.close();
});
process.on('SIGINT', () => {
  wasmPool.close();
});

try {
  const modid = crypto.createHash('blake2b512').update(buf).digest('base64url');
  try {
    const res = await wasmPool.withWorker(async (worker) => {
      const greet1 = await worker.callStrFn(modid, mod, 'greet', 'world', {
        timeoutMS: 100,
      });
      const greet2 = await worker.callStrFn(modid, mod, 'greet', 'kevin', {
        timeoutMS: 100,
      });
      return {greet1, greet2};
    });
    console.log(res);
  } catch (err) {
    console.log('res 1 err', err);
  }
  try {
    const res = await wasmPool.withWorker(async (worker) => {
      return worker.callStrFn(modid, mod, 'long_greet', 'world', {
        timeoutMS: 100,
      });
    });
    console.log(res);
  } catch (err) {
    console.log('res 2 err', err);
  }
  try {
    debugger;
    const res = await wasmPool.withWorker(async (worker) => {
      return worker.callStrFn(modid, mod, 'greet', 'world', {
        timeoutMS: 100,
      });
    });
    console.log(res);
  } catch (err) {
    console.log('res 3 err', err);
  }
} finally {
  wasmPool.close();
}
