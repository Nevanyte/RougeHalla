//! Source `BotManager.ts` delay line (P-BOTS-7 remainder): a bot's command is clicked at `at`, reaches the server
//! `latencyMs` +- `jitterMs` later, never before the command ahead of it, and is applied by the first step at or after its
//! arrival. The jitter stream is its own (seed mixed with tag 1), so tuning the latency never reshuffles who arrives.
use std::collections::VecDeque;

use super::random::{mix, Rng};

/// The source `MAX_QUEUED`: past it a command is refused (the bot's message would be dropped).
pub const MAX_QUEUED: usize = 256;

/// One bot's commands in flight to the server: arrivals are never out of order, as on a TCP connection.
#[derive(Clone, Debug)]
pub struct DelayLine<T> {
    queue: VecDeque<(f64, T)>,
    last_arrival: f64,
}
impl<T> Default for DelayLine<T> {
    fn default() -> Self {
        Self::new()
    }
}
impl<T> DelayLine<T> {
    pub fn new() -> Self {
        Self {
            queue: VecDeque::new(),
            last_arrival: f64::NEG_INFINITY,
        }
    }

    /// The line's own stream: the manager seed mixed with tag 1 (source `lineRng`).
    pub fn rng(manager_seed: u32) -> Rng {
        Rng::new(mix(manager_seed, 1))
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    pub fn len(&self) -> usize {
        self.queue.len()
    }

    pub fn last_arrival(&self) -> f64 {
        self.last_arrival
    }

    /// Source `deliver`: false when the line already holds `MAX_QUEUED` commands. The returned arrival is the command's
    /// server time (what `pop_due` compares against a step's time).
    pub fn enqueue(
        &mut self,
        rng: &mut Rng,
        at: f64,
        latency_ms: f64,
        jitter_ms: f64,
        command: T,
    ) -> Option<f64> {
        if self.queue.len() >= MAX_QUEUED {
            return None;
        }
        let jitter = (rng.next_f64() * 2. - 1.) * jitter_ms;
        let arrival = self.last_arrival.max(at + latency_ms + jitter);
        self.last_arrival = arrival;
        self.queue.push_back((arrival, command));
        Some(arrival)
    }

    /// Source `beforeStep`: every command whose arrival has come leaves the line in order (source delivers into the input
    /// queue right before the step at `step_t` applies it).
    pub fn pop_due(&mut self, step_t: f64, out: &mut Vec<T>) {
        while let Some((arrival, _)) = self.queue.front() {
            if *arrival > step_t {
                break;
            }
            let (_, command) = self.queue.pop_front().expect("front checked");
            out.push(command);
        }
    }
}

#[cfg(test)]
mod tests;
