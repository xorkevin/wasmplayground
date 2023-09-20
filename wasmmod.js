import fs from 'node:fs/promises';

// TextEncoder only supports utf-8
const textEncoder = new TextEncoder();

// TextDecoder only supports utf-8
const textDecoder = new TextDecoder();

const wasmbuf = await fs.readFile(
  './target/wasm32-unknown-unknown/release/wasmplayground.wasm',
);
const wasmmod = await WebAssembly.compile(wasmbuf);

let wasmInstance;
wasmInstance = await WebAssembly.instantiate(wasmmod, {
  __wasm_import: {
    __js_throw: (ptr, size) => {
      const mem = new Uint8Array(wasmInstance.exports.memory.buffer, ptr, size);
      throw new Error(`error from wasm mod: ${textDecoder.decode(mem)}`);
    },
  },
});

const HEADER_SIZE = wasmInstance.exports.get_malloc_header_size();
if (HEADER_SIZE != 4) {
  throw new Error('header size not 4 bytes');
}

const mallocBytes = (b) => {
  const ptr = wasmInstance.exports.malloc(b.length);
  const mem = new Uint8Array(
    wasmInstance.exports.memory.buffer,
    ptr + HEADER_SIZE,
    b.length,
  );
  mem.set(b);
  return ptr;
};

const free = (ptr) => {
  wasmInstance.exports.free(ptr);
};

const readBytes = (ptr) => {
  const size = new DataView(
    wasmInstance.exports.memory.buffer,
    ptr,
    HEADER_SIZE,
  ).getUint32(0, false);
  const mem = new Uint8Array(
    wasmInstance.exports.memory.buffer,
    ptr + HEADER_SIZE,
    size,
  );
  return mem;
};

const mallocString = (s) => {
  const b = textEncoder.encode(s);
  return mallocBytes(b);
};

const readStringAndFree = (ptr) => {
  try {
    const mem = readBytes(ptr);
    const str = textDecoder.decode(mem);
    return str;
  } finally {
    free(ptr);
  }
};

const greet = (name) => {
  const namearg = mallocString(name);
  try {
    const greeting = wasmInstance.exports.greet(namearg);
    return readStringAndFree(greeting);
  } finally {
    free(namearg);
  }
};

console.log(greet('world'));
