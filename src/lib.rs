const ALIGN: usize = std::mem::align_of::<usize>();
const HEADER_SIZE: usize = std::mem::size_of::<usize>();

#[no_mangle]
pub const extern "C" fn get_malloc_header_size() -> usize {
    HEADER_SIZE
}

#[link(wasm_import_module = "__wasm_import")]
extern "C" {
    fn __js_throw(ptr: *const u8, size: usize) -> !;
}

#[cold]
pub fn throw_str(s: &str) -> ! {
    unsafe { __js_throw(s.as_ptr(), s.len()) }
}

// caller freed
#[no_mangle]
pub extern "C" fn malloc(size: usize) -> *mut u8 {
    let total_size = HEADER_SIZE + size;
    if let Ok(layout) = std::alloc::Layout::from_size_align(total_size, ALIGN) {
        unsafe {
            let ptr = std::alloc::alloc(layout);
            if ptr.is_null() {
                throw_str("malloc failure");
            }
            write_malloc_size(ptr, size);
            ptr
        }
    } else {
        throw_str("malloc failure");
    }
}

#[no_mangle]
pub unsafe extern "C" fn realloc(ptr: *mut u8, size: usize) -> *mut u8 {
    let total_new_size = HEADER_SIZE + size;
    let total_old_size = HEADER_SIZE + get_malloc_size(ptr);
    if let Ok(layout) = std::alloc::Layout::from_size_align(total_old_size, ALIGN) {
        let ptr = std::alloc::realloc(ptr, layout, total_new_size);
        if ptr.is_null() {
            throw_str("malloc failure");
        }
        write_malloc_size(ptr, size);
        ptr
    } else {
        throw_str("malloc failure");
    }
}

#[no_mangle]
pub unsafe extern "C" fn free(ptr: *mut u8) {
    let total_size = HEADER_SIZE + get_malloc_size(ptr);
    let layout = std::alloc::Layout::from_size_align_unchecked(total_size, ALIGN);
    std::alloc::dealloc(ptr, layout);
}

#[no_mangle]
pub unsafe extern "C" fn get_malloc_size(ptr: *const u8) -> usize {
    let mut old_size_bytes = [0u8; HEADER_SIZE];
    old_size_bytes.clone_from_slice(std::slice::from_raw_parts(ptr, HEADER_SIZE));
    usize::from_be_bytes(old_size_bytes)
}

unsafe fn write_malloc_size(ptr: *mut u8, size: usize) {
    let b = std::slice::from_raw_parts_mut(ptr, HEADER_SIZE);
    b.copy_from_slice(&size.to_be_bytes()[..]);
}

pub unsafe fn get_ptr_bytes_mut(ptr: *mut u8) -> &'static mut [u8] {
    let total_size = HEADER_SIZE + get_malloc_size(ptr);
    &mut std::slice::from_raw_parts_mut(ptr, total_size)[HEADER_SIZE..]
}

pub unsafe fn get_ptr_bytes(ptr: *const u8) -> &'static [u8] {
    let total_size = HEADER_SIZE + get_malloc_size(ptr);
    &std::slice::from_raw_parts(ptr, total_size)[HEADER_SIZE..]
}

pub unsafe fn read_str_arg(ptr: *const u8) -> String {
    match String::from_utf8(Vec::from(unsafe { get_ptr_bytes(ptr) })) {
        Ok(v) => v,
        Err(e) => throw_str(&format!("invalid utf8 string: {:?}", e)),
    }
}

// caller freed
pub fn malloc_str_ret(s: &str) -> *mut u8 {
    let buf = malloc(s.len());
    unsafe {
        let data = &mut std::slice::from_raw_parts_mut(buf, HEADER_SIZE + s.len())[HEADER_SIZE..];
        data.copy_from_slice(s.as_bytes())
    }
    buf
}

// arg is caller freed
#[no_mangle]
pub extern "C" fn greet(nameptr: *const u8) -> *mut u8 {
    let name = unsafe { read_str_arg(nameptr) };
    malloc_str_ret(&format!("Hello, {}", name))
}

// arg is caller freed
#[no_mangle]
pub extern "C" fn long_greet(nameptr: *const u8) -> *mut u8 {
    unsafe { read_str_arg(nameptr) };
    loop {}
}

// arg is caller freed
#[no_mangle]
pub extern "C" fn throw_greet(nameptr: *const u8) -> *mut u8 {
    let name = unsafe { read_str_arg(nameptr) };
    throw_str(&format!("greet error: {}", name));
}
