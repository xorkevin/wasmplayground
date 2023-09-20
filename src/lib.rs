const ALIGN: usize = std::mem::align_of::<usize>();
const USIZE_SIZE: usize = std::mem::size_of::<usize>();

#[no_mangle]
pub const extern "C" fn get_usize_size() -> usize {
    USIZE_SIZE
}

#[cold]
fn malloc_failure() -> ! {
    // TODO throw_str("invalid malloc request");
    std::process::abort();
}

#[no_mangle]
pub extern "C" fn malloc(size: usize) -> *mut u8 {
    let total_size = USIZE_SIZE + size;
    if let Ok(layout) = std::alloc::Layout::from_size_align(total_size, ALIGN) {
        unsafe {
            let ptr = std::alloc::alloc(layout);
            if ptr.is_null() {
                malloc_failure();
            }
            write_malloc_size(ptr, size);
            ptr
        }
    } else {
        malloc_failure();
    }
}

#[no_mangle]
pub unsafe extern "C" fn realloc(ptr: *mut u8, size: usize) -> *mut u8 {
    let total_new_size = USIZE_SIZE + size;
    let total_old_size = USIZE_SIZE + get_malloc_size(ptr);
    if let Ok(layout) = std::alloc::Layout::from_size_align(total_old_size, ALIGN) {
        let ptr = std::alloc::realloc(ptr, layout, total_new_size);
        if ptr.is_null() {
            malloc_failure();
        }
        write_malloc_size(ptr, size);
        ptr
    } else {
        malloc_failure();
    }
}

#[no_mangle]
pub unsafe extern "C" fn free(ptr: *mut u8) {
    let total_size = USIZE_SIZE + get_malloc_size(ptr);
    let layout = std::alloc::Layout::from_size_align_unchecked(total_size, ALIGN);
    std::alloc::dealloc(ptr, layout);
}

pub unsafe fn get_ptr_bytes_mut(ptr: *mut u8, size: usize) -> &'static mut [u8] {
    std::slice::from_raw_parts_mut(ptr, size)
}

pub unsafe fn get_ptr_bytes(ptr: *const u8, size: usize) -> &'static [u8] {
    std::slice::from_raw_parts(ptr, size)
}

#[no_mangle]
pub unsafe extern "C" fn get_malloc_size(ptr: *const u8) -> usize {
    let mut old_size_bytes = [0u8; USIZE_SIZE];
    old_size_bytes.clone_from_slice(get_ptr_bytes(ptr, USIZE_SIZE));
    usize::from_be_bytes(old_size_bytes)
}

unsafe fn write_malloc_size(ptr: *mut u8, size: usize) {
    let b = get_ptr_bytes_mut(ptr, USIZE_SIZE);
    b.copy_from_slice(&size.to_be_bytes()[..]);
}
