// TextEncoder only supports utf-8
const textEncoder = new TextEncoder();

// TextDecoder only supports utf-8
const textDecoder = new TextDecoder();

export class WasmModInstance {
  constructor(mod) {
    this.mod = mod;
  }

  async init() {
    this.instance = await WebAssembly.instantiate(this.mod, {
      __wasm_import: {
        __js_throw: (ptr, size) => {
          const mem = new Uint8Array(
            this.instance.exports.memory.buffer,
            ptr,
            size,
          );
          throw new Error(`error from wasm mod: ${textDecoder.decode(mem)}`);
        },
      },
    });

    this.HEADER_SIZE = this.instance.exports.get_malloc_header_size();
    if (this.HEADER_SIZE !== 4) {
      throw new Error('header size greater than 4 bytes');
    }
  }

  mallocBytes(b) {
    const ptr = this.instance.exports.malloc(b.length);
    const mem = new Uint8Array(
      this.instance.exports.memory.buffer,
      ptr + this.HEADER_SIZE,
      b.length,
    );
    mem.set(b);
    return ptr;
  }

  free(ptr) {
    this.instance.exports.free(ptr);
  }

  readBytes(ptr) {
    const size = new DataView(
      this.instance.exports.memory.buffer,
      ptr,
      this.HEADER_SIZE,
    ).getUint32(0, false);
    const mem = new Uint8Array(
      this.instance.exports.memory.buffer,
      ptr + this.HEADER_SIZE,
      size,
    );
    return mem;
  }

  mallocString(s) {
    const b = textEncoder.encode(s);
    return this.mallocBytes(b);
  }

  readStringAndFree(ptr) {
    try {
      const mem = this.readBytes(ptr);
      const str = textDecoder.decode(mem);
      return str;
    } finally {
      this.free(ptr);
    }
  }

  callStrFn(name, arg) {
    const argptr = this.mallocString(arg);
    try {
      const res = this.instance.exports[name](argptr);
      return this.readStringAndFree(res);
    } finally {
      this.free(argptr);
    }
  }
}
