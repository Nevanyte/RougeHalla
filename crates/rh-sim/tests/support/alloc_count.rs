// Shared allocation counter for rh-sim tests (P-TEST-HARDEN-1).
//
// STUB: counts every thread (a process-wide atomic), like `dhat::HeapStats::total_blocks`. The implementer replaces the
// counter with a thread-local one so that only the measuring thread's blocks are counted; the API stays.
//
// How to write an allocation test (the implementer finishes this comment):
//   1. `#[path = "support/alloc_count.rs"] mod alloc_count;` and
//      `#[global_allocator] static ALLOC: alloc_count::CountingAlloc = alloc_count::CountingAlloc;`
//   2. Warm up outside the measured section, then
//      `let (_, blocks) = alloc_count::blocks_on_this_thread(|| steady_section()); assert_eq!(blocks, 0);`
#![allow(dead_code, unsafe_code)]
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicU64, Ordering};

static BLOCKS: AtomicU64 = AtomicU64::new(0);

/// A `GlobalAlloc` over `System` that counts `alloc`, `alloc_zeroed` and `realloc` calls (one block each).
pub struct CountingAlloc;

unsafe impl GlobalAlloc for CountingAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        BLOCKS.fetch_add(1, Ordering::Relaxed);
        System.alloc(layout)
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        BLOCKS.fetch_add(1, Ordering::Relaxed);
        System.alloc_zeroed(layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        BLOCKS.fetch_add(1, Ordering::Relaxed);
        System.realloc(ptr, layout, new_size)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
}

/// Runs `f` and returns its result with the number of heap blocks requested while it ran.
pub fn blocks_on_this_thread<R>(f: impl FnOnce() -> R) -> (R, u64) {
    let before = BLOCKS.load(Ordering::Relaxed);
    let r = f();
    (r, BLOCKS.load(Ordering::Relaxed) - before)
}
