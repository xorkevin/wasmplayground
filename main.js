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

const res = await wasmPool.withWorker(async (worker) => {
  return worker.callStrFn(
    crypto.createHash('blake2b512').update(buf).digest('base64url'),
    mod,
    'greet',
    'world',
  );
});
console.log(res);

wasmPool.close();
