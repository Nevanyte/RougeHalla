//! Test-only allocation counter (P-TEST-HARDEN-1). A dev-dependency only: no shipped crate may depend on it normally.
//!
//! The count is per thread: a `thread_local!` `Cell<u64>` with const init and no destructor, so the allocator never
//! allocates or recurses, and other threads (libtest's main thread, parallel tests, threads the measured code spawns)
//! cannot add to the reading. Tests therefore need no lock and may run in parallel.
//!
//! How to write an allocation test:
//!   1. In the test binary: `#[global_allocator] static ALLOC: rh_alloc_count::CountingAlloc = rh_alloc_count::CountingAlloc;`
//!   2. Warm up outside the measured section (first-use buffers, caches, lazily grown vectors), then measure only the
//!      steady section:
//!      `let (_, blocks) = rh_alloc_count::blocks_on_this_thread(|| steady_section()); assert_eq!(blocks, 0);`
//!   3. Each `alloc`, `alloc_zeroed` and `realloc` call is one block; `dealloc` is none. `Vec::with_capacity(0)` and
//!      `Box::new(())` allocate nothing, so a test that must see one block uses a sized allocation.
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

thread_local! {
    static BLOCKS: Cell<u64> = const { Cell::new(0) };
}

#[inline]
fn bump() {
    // `try_with` so an allocation during thread teardown cannot panic; `u64` has no destructor, so no registration happens.
    let _ = BLOCKS.try_with(|c| c.set(c.get() + 1));
}

/// A `GlobalAlloc` over `System` that counts `alloc`, `alloc_zeroed` and `realloc` calls (one block each) on the calling thread.
pub struct CountingAlloc;

unsafe impl GlobalAlloc for CountingAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        bump();
        System.alloc(layout)
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        bump();
        System.alloc_zeroed(layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        bump();
        System.realloc(ptr, layout, new_size)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
}

/// Runs `f` and returns its result with the number of heap blocks the calling thread requested while it ran.
pub fn blocks_on_this_thread<R>(f: impl FnOnce() -> R) -> (R, u64) {
    let before = BLOCKS.with(Cell::get);
    let r = f();
    (r, BLOCKS.with(Cell::get) - before)
}
