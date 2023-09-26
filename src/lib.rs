use serde;
use serde_json;

#[link(wasm_import_module = "__wasm_import")]
extern "C" {
    fn __wasm_str_throw(ptr: *const u8, size: usize) -> !;
    fn __wasm_alloc(ptr: *const u8, size: usize) -> usize;
    fn __wasm_free(id: usize);
    fn __wasm_mem_size(id: usize) -> usize;
    fn __wasm_mem_read(id: usize, ptr: *mut u8);
}

#[cold]
pub fn wasm_str_throw(s: &str) -> ! {
    unsafe { __wasm_str_throw(s.as_ptr(), s.len()) }
}

pub fn wasm_str_alloc(s: &str) -> usize {
    unsafe { __wasm_alloc(s.as_ptr(), s.len()) }
}

pub fn wasm_str_free(id: usize) {
    unsafe { __wasm_free(id) }
}

pub fn wasm_str_read(id: usize) -> String {
    let size = unsafe { __wasm_mem_size(id) };
    let mut buf = Vec::<u8>::with_capacity(size);
    unsafe {
        __wasm_mem_read(id, buf.as_mut_ptr());
        buf.set_len(size);
    }
    match String::from_utf8(buf) {
        Ok(v) => v,
        Err(_) => wasm_str_throw("invalid utf8 string"),
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Person {
    name: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Greeting {
    message: String,
}

fn read_person_arg(arg: usize) -> Person {
    let strarg = wasm_str_read(arg);
    match serde_json::from_str(&strarg) {
        Ok(v) => v,
        Err(_) => wasm_str_throw("invalid greet arg"),
    }
}

fn write_greeting_res(greeting: Greeting) -> usize {
    match serde_json::to_string(&greeting) {
        Ok(v) => wasm_str_alloc(&v),
        Err(_) => wasm_str_throw("invalid greet arg"),
    }
}

#[no_mangle]
pub extern "C" fn greet(arg: usize) -> usize {
    let person = read_person_arg(arg);
    write_greeting_res(Greeting {
        message: format!("Hello, {}", person.name),
    })
}

#[no_mangle]
pub extern "C" fn long_greet(arg: usize) -> usize {
    read_person_arg(arg);
    loop {}
}

#[no_mangle]
pub extern "C" fn throw_greet(arg: usize) -> usize {
    let person = read_person_arg(arg);
    wasm_str_throw(&format!("greet error: {}", person.name));
}

#[no_mangle]
pub extern "C" fn panic_greet(arg: usize) -> usize {
    let person = read_person_arg(arg);
    panic!("greet panic: {}", person.name);
}
