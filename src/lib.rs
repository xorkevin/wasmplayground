#[cold]
fn malloc_failure() -> ! {
    // TODO throw_str("invalid malloc request");
    std::process::abort();
}

#[no_mangle]
pub extern "C" fn malloc(size: usize) -> *mut u8 {
    let align = std::mem::align_of::<usize>();
    if let Ok(layout) = std::alloc::Layout::from_size_align(size, align) {
        if layout.size() == 0 {
            // return valid unique pointer that should not be dereferenced
            return align as *mut u8;
        }
        let ptr = unsafe { std::alloc::alloc(layout) };
        if ptr.is_null() {
            malloc_failure();
        }
        return ptr;
    }
    malloc_failure();
}

#[no_mangle]
pub extern "C" fn realloc(ptr: *mut u8, old_size: usize, new_size: usize) -> *mut u8 {
    let align = std::mem::align_of::<usize>();
    if old_size == 0 {
        return malloc(new_size);
    }
    if let Ok(layout) = std::alloc::Layout::from_size_align(old_size, align) {
        let ptr = unsafe { std::alloc::realloc(ptr, layout, new_size) };
        if ptr.is_null() {
            malloc_failure();
        }
        return ptr;
    }
    malloc_failure();
}

#[no_mangle]
pub extern "C" fn free(ptr: *mut u8, size: usize) {
    if size == 0 {
        return;
    }
    let align = std::mem::align_of::<usize>();
    unsafe {
        let layout = std::alloc::Layout::from_size_align_unchecked(size, align);
        std::alloc::dealloc(ptr, layout);
    }
}

pub fn get_ptr_bytes(ptr: *const u8, size: usize) -> &'static [u8] {
    unsafe { std::slice::from_raw_parts(ptr, size) }
}
