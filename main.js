import fs from 'node:fs/promises';

import {WasmModInstance} from './wasmmod.js';

const wasmbuf = await fs.readFile('./bin/wasmplayground.wasm');
const wasmmod = await WebAssembly.compile(wasmbuf);

const wasmModInstance = new WasmModInstance(wasmmod);
await wasmModInstance.init();

console.log(wasmModInstance.callStrFn('greet', 'world'));
