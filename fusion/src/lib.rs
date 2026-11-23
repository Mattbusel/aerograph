//! Aerograph fusion: the real decode + cross-node fusion + spoofer
//! triangulation at the heart of the grid.
//!
//! The same code runs on the [aggregator](../aggregator) and, compiled to
//! wasm, in the browser, so the server and the public map produce byte-identical
//! results. Nothing here invents a capability: every field in a [`GridState`]
//! is something [`remoteid`], [`remoteid_sentinel`] or `misb` actually computes
//! from a decoded frame.
//!
//! - [`report`] is the node -> aggregator wire contract.
//! - [`fuse::Grid`] ingests reports and produces [`state::GridState`] snapshots.
//! - [`triangulate`] localizes a flood's puppeteer radio by log-distance
//!   path-loss multilateration.
//! - [`sim`] (feature `sim`) builds the labelled simulated city mesh the public
//!   demo runs on.

pub mod fuse;
pub mod misb_aim;
pub mod report;
pub mod state;
pub mod triangulate;

#[cfg(feature = "sim")]
pub mod sim;

pub use fuse::Grid;
pub use report::{DetectionReport, NodeInfo, Sighting};
pub use state::{DroneEntity, GridState, Triangulation};
