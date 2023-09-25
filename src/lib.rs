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

#[no_mangle]
pub extern "C" fn greet(namearg: usize) -> usize {
    let name = wasm_str_read(namearg);
    wasm_str_alloc(&("Hello, ".to_owned() + &name))
}

#[no_mangle]
pub extern "C" fn long_greet(namearg: usize) -> usize {
    wasm_str_read(namearg);
    loop {}
}

#[no_mangle]
pub extern "C" fn throw_greet(namearg: usize) -> usize {
    let name = wasm_str_read(namearg);
    wasm_str_throw(&("greet error: ".to_owned() + &name));
}

#[no_mangle]
pub extern "C" fn panic_greet(namearg: usize) -> usize {
    let name = wasm_str_read(namearg);
    panic!("greet panic: {}", name);
}
