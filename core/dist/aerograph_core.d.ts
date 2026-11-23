/* tslint:disable */
/* eslint-disable */

/**
 * The grid handle the browser keeps for the whole session.
 */
export class Grid {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create a grid from a JSON config:
     * `{ city:{center_lat,center_lon}, nodes:[{id,lat,lon}], drones, flood_at_step, fakes_per_radio, puppeteer:{lat,lon}, hearing_floor_dbm }`.
     * Only `city` is required; everything else defaults to a Manhattan mesh.
     */
    constructor(config_json: string);
    /**
     * Advance the grid one tick and return the fused GridState JSON. The page
     * loops this at about 2 Hz; the `step` argument is accepted for API
     * symmetry but the simulation advances its own internal clock.
     */
    run_grid(_step: number): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_grid_free: (a: number, b: number) => void;
    readonly grid_new: (a: number, b: number) => [number, number, number];
    readonly grid_run_grid: (a: number, b: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
