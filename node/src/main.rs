//! Aerograph sensor node (firmware-side decode + PC shim).
//!
//! A real $6 node is an ESP32-C3 running the `remoteid-esp32` firmware: it
//! sniffs Bluetooth and Wi-Fi, decodes Remote ID on-chip with the no_std
//! `remoteid` crate, and streams what it heard. This binary is the PC side of
//! that link. It has two modes, both of which emit the exact same
//! `DetectionReport` wire format:
//!
//!   decode  Read sensor records (one per line: `node_id lat lon rssi
//!           transport counter raw_hex`) as a real node would stream them over
//!           serial, re-decode `raw_hex` with `remoteid`, and emit full reports
//!           with the decoded echo filled by the real decoder.
//!
//!   sim     Drive the labelled simulated city mesh (no hardware) and emit the
//!           reports it produces. This is what feeds the public demo.
//!
//! Reports go to stdout as newline-delimited JSON, or to an aggregator with
//! `--post <url>` (HTTP POST /ingest).

use std::io::{self, BufRead, Write};

use aerograph_fusion::report::{from_hex, Decoded, DetectionReport, NodeInfo, Sighting, SCHEMA};
use aerograph_fusion::sim::{GridSim, GridSimConfig};
use remoteid::{Message, OperatorLocationType};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(String::as_str).unwrap_or("help");
    let post = flag_value(&args, "--post");

    let result = match mode {
        "sim" => run_sim(&args, post.as_deref()),
        "decode" => run_decode(post.as_deref()),
        _ => {
            eprintln!(
                "aerograph-node <mode> [--post http://host:port]\n\
                 \n\
                 modes:\n\
                 \x20 sim      emit reports from the labelled simulated city mesh\n\
                 \x20 decode   decode sensor records from stdin and emit reports\n\
                 \n\
                 decode stdin record (whitespace separated):\n\
                 \x20 <node_id> <lat> <lon> <rssi_dbm> <transport> <counter> <raw_hex>\n\
                 \x20 e.g.  node-0007 40.7411 -73.9897 -72 bluetooth4 41 0d07...\n"
            );
            Ok(())
        }
    };
    if let Err(e) = result {
        eprintln!("aerograph-node: {e}");
        std::process::exit(1);
    }
}

fn flag_value(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1).cloned())
}

/// Emit one report: to the aggregator if `post` is set, else to stdout.
fn sink(report: &DetectionReport, post: Option<&str>, out: &mut impl Write) -> io::Result<()> {
    if let Some(url) = post {
        let endpoint = format!("{}/ingest", url.trim_end_matches('/'));
        match ureq::post(&endpoint).send_json(report) {
            Ok(_) => Ok(()),
            Err(e) => {
                writeln!(io::stderr(), "post failed: {e}")?;
                Ok(())
            }
        }
    } else {
        let line = serde_json::to_string(report).map_err(io::Error::other)?;
        writeln!(out, "{line}")
    }
}

fn run_sim(args: &[String], post: Option<&str>) -> io::Result<()> {
    let do_loop = args.iter().any(|a| a == "--loop");
    let sim_cfg = GridSimConfig::manhattan();
    let mut sim = GridSim::new(sim_cfg);
    let mut out = io::BufWriter::new(io::stdout());

    if do_loop {
        // Live mode: one step every 500 ms, forever.
        loop {
            for r in sim.step() {
                sink(&r, post, &mut out)?;
            }
            out.flush()?;
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    } else {
        for r in sim.all_reports() {
            sink(&r, post, &mut out)?;
        }
        out.flush()?;
    }
    Ok(())
}

fn run_decode(post: Option<&str>) -> io::Result<()> {
    let stdin = io::stdin();
    let mut out = io::BufWriter::new(io::stdout());
    for line in stdin.lock().lines() {
        let line = line?;
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        match parse_record(line) {
            Some(report) => sink(&report, post, &mut out)?,
            None => writeln!(io::stderr(), "skipping malformed record: {line}")?,
        }
    }
    out.flush()?;
    Ok(())
}

/// Parse one sensor record and run the real decode over `raw_hex`.
fn parse_record(line: &str) -> Option<DetectionReport> {
    let f: Vec<&str> = line.split_whitespace().collect();
    if f.len() != 7 {
        return None;
    }
    let node_id = f[0].to_string();
    let lat: f64 = f[1].parse().ok()?;
    let lon: f64 = f[2].parse().ok()?;
    let rssi: i32 = f[3].parse().ok()?;
    let transport = f[4].to_string();
    let counter: u32 = f[5].parse().ok()?;
    let raw_hex = f[6].to_lowercase();

    let bytes = from_hex(&raw_hex)?;
    if bytes.len() != 25 {
        return None;
    }
    // Real decode (the same remoteid code the ESP32 firmware runs).
    let msg = Message::decode(&bytes).ok()?;
    let decoded = decoded_echo(&msg);

    let now = now_ms();
    Some(DetectionReport {
        schema: SCHEMA.to_string(),
        node: NodeInfo {
            id: node_id,
            lat,
            lon,
            clock_ms: now,
        },
        sighting: Sighting {
            ts_ms: now,
            transport,
            transmitter: tx_label_from_record(&msg, &raw_hex),
            rssi_dbm: rssi,
            counter,
            raw_hex,
            decoded,
            misb: None,
        },
    })
}

/// A real node keys a sighting by the radio address it heard. On the serial
/// link that address rides alongside the frame; here, where the record does not
/// carry it, derive a stable label from the UAS ID so cross-node dedupe still
/// works for the shim.
fn tx_label_from_record(msg: &Message, raw_hex: &str) -> String {
    if let Message::BasicId(id) = msg {
        if let Some(uid) = id.uas_id_str() {
            return format!("other:{}", fnv1a(uid.as_bytes()));
        }
    }
    format!("other:{}", fnv1a(raw_hex.as_bytes()))
}

fn fnv1a(data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in data {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn decoded_echo(msg: &Message) -> Decoded {
    let mut d = Decoded::default();
    match msg {
        Message::BasicId(id) => {
            d.uas_id = id.uas_id_str().map(|s| s.to_string());
            d.model = Some(format!("{:?}", id.ua_type));
        }
        Message::Location(loc) => {
            d.drone_lat = Some(loc.latitude);
            d.drone_lon = Some(loc.longitude);
            d.alt_m = loc.altitude_geo.map(|a| a as f64);
            d.height_m = loc.height.map(|h| h as f64);
            d.yaw_deg = loc.direction.map(|h| h as f64);
        }
        Message::System(sys) => {
            if let Some((lat, lon)) = sys.operator_position() {
                match sys.operator_location_type {
                    OperatorLocationType::Takeoff => {
                        d.takeoff_lat = Some(lat);
                        d.takeoff_lon = Some(lon);
                    }
                    _ => {
                        d.pilot_lat = Some(lat);
                        d.pilot_lon = Some(lon);
                    }
                }
            }
        }
        Message::OperatorId(op) => {
            d.operator_id = op.operator_id_str().map(|s| s.to_string());
        }
        _ => {}
    }
    d
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
