import { JSON } from "json-as/assembly";

@external("__wasm_import", "__wasm_str_throw")
declare function __wasm_str_throw(ptr: ArrayBuffer, size: u32): void

@external("__wasm_import", "__wasm_alloc")
declare function __wasm_alloc(ptr: ArrayBuffer, size: u32): u32

@external("__wasm_import", "__wasm_free")
declare function __wasm_free(id: u32): void

@external("__wasm_import", "__wasm_mem_size")
declare function __wasm_mem_size(id: u32): u32;

@external("__wasm_import", "__wasm_mem_read")
declare function __wasm_mem_read(id: u32, ptr: ArrayBuffer): void;

function wasmStrThrow(s: string): void {
  const buf = String.UTF8.encode(s);
  __wasm_str_throw(buf, buf.byteLength);
}

function wasmStrAlloc(s: string): u32 {
  const buf = String.UTF8.encode(s);
  return __wasm_alloc(buf, buf.byteLength);
}

function wasmStrFree(id: u32): void {
  __wasm_free(id);
}

function wasmStrRead(id: u32): string {
  const size = __wasm_mem_size(id);
  const buf = new ArrayBuffer(size);
  __wasm_mem_read(id, buf);
  return String.UTF8.decode(buf);
}

function envAbort(message: usize, fileName: usize, line: u32, column: u32): void {
  wasmStrThrow("abort");
}

@json
class Person {
  name!: string;
}

@json
class Greeting {
  message!: string;
}

function readPersonArg(arg: u32): Person {
  const strarg = wasmStrRead(arg);
  return JSON.parse<Person>(strarg);
}

function writeGreetingRes(greeting: Greeting): u32 {
  const s = JSON.stringify(greeting);
  return wasmStrAlloc(s);
}

export function greet(arg: u32): u32 {
  const person = readPersonArg(arg);
  return writeGreetingRes({
    message: `Hello, ${person.name}`,
  });
}

export function long_greet(arg: u32): u32 {
  readPersonArg(arg);
  while (true) {}
}

export function throw_greet(arg: u32): u32 {
  let person = readPersonArg(arg);
  wasmStrThrow(`greet error: ${person.name}`);
  return writeGreetingRes({
    message: `Hello, ${person.name}`,
  });
}

export function panic_greet(arg: u32): u32 {
  let person = readPersonArg(arg);
  wasmStrThrow(`greet error: ${person.name}`);
  return writeGreetingRes({
    message: `Hello, ${person.name}`,
  });
}
