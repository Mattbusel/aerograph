//! Writes a real GridState snapshot to dist/sample_state.json so the /web agent
//! can lay out the map offline. This runs the exact same fusion the wasm does.
use std::io::Write;

fn main() {
    let center = [40.7411_f64, -73.9897_f64];
    let mlat = 111_320.0;
    let mlon = 111_320.0 * center[0].to_radians().cos();
    let mut nodes = String::new();
    for i in 0..8 {
        let ang = (i as f64) * std::f64::consts::TAU / 8.0;
        let lat = center[0] + (ang.cos() * 500.0) / mlat;
        let lon = center[1] + (ang.sin() * 500.0) / mlon;
        if i > 0 {
            nodes.push(',');
        }
        nodes.push_str(&format!(
            "{{\"id\":\"node-{:04}\",\"lat\":{lat},\"lon\":{lon}}}",
            i + 1
        ));
    }
    let cfg = format!(
        "{{\"city\":{{\"center_lat\":{},\"center_lon\":{}}},\"nodes\":[{}],\"drones\":5,\"fakes_per_radio\":120,\"puppeteer\":{{\"lat\":40.7402,\"lon\":-73.9881}}}}",
        center[0], center[1], nodes
    );
    let mut grid = aerograph_core::Grid::new(&cfg).expect("config");
    let mut state = String::new();
    for step in 0..24 {
        state = grid.run_grid(step);
    }
    let mut f = std::fs::File::create("dist/sample_state.json").unwrap();
    f.write_all(state.as_bytes()).unwrap();
    println!("wrote dist/sample_state.json ({} bytes)", state.len());
}
