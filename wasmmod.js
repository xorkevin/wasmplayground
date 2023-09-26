// TextDecoder only supports utf-8
const textDecoder = new TextDecoder();

const MAX_U32 = 2 ** 32 - 1;

export class WasmModInstance {
  #mod;
  #heap;
  #heapid;
  #instance;

  constructor(mod) {
    this.#mod = mod;
    this.#heap = new Map();
    this.#heapid = 1;
  }

  #getid() {
    let crossedBoundary = false;
    while (this.#heap.has(this.#heapid)) {
      this.#heapid++;
      if (this.#heapid >= MAX_U32) {
        if (crossedBoundary) {
          throw new Error('failed allocating string');
        }
        crossedBoundary = true;
        this.#heapid = 1;
      }
    }
    return this.#heapid;
  }

  allocBytes(b) {
    const id = this.#getid();
    this.#heap.set(id, b);
    return id;
  }

  free(id) {
    const didRm = this.#heap.delete(id);
    if (!didRm) {
      throw new Error(`invalid mem id: ${id}`);
    }
  }

  readMem(id) {
    const b = this.#heap.get(id);
    if (!b) {
      throw new Error(`invalid mem id: ${id}`);
    }
    return b;
  }

  readMemAndFree(id) {
    const b = this.readMem(id);
    this.free(id);
    return b;
  }

  async init() {
    this.#instance = await WebAssembly.instantiate(this.#mod, {
      __wasm_import: {
        __wasm_str_throw: (ptr, size) => {
          const mem = new Uint8Array(
            this.#instance.exports.memory.buffer,
            ptr,
            size,
          );
          throw new Error(`error from wasm mod: ${textDecoder.decode(mem)}`);
        },
        __wasm_alloc: (ptr, size) => {
          const mem = new Uint8Array(
            this.#instance.exports.memory.buffer,
            ptr,
            size,
          );
          const b = new Uint8Array(size);
          b.set(mem);
          return this.allocBytes(b);
        },
        __wasm_free: (id) => {
          this.free(id);
        },
        __wasm_mem_size: (id) => {
          const b = this.readMem(id);
          return b.length;
        },
        __wasm_mem_read: (id, ptr) => {
          const b = this.readMem(id);
          const mem = new Uint8Array(
            this.#instance.exports.memory.buffer,
            ptr,
            b.length,
          );
          mem.set(b);
        },
      },
    });
  }

  callBytesFn(name, arg) {
    const f = this.#instance.exports[name];
    if (!f) {
      throw new Error(`invalid export function: ${name}`);
    }
    const argid = this.allocBytes(arg);
    try {
      const ret = f(argid);
      return this.readMemAndFree(ret);
    } finally {
      this.free(argid);
    }
  }
}
