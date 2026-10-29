import { TAU } from "../rs/MathConstants";

/**
 * RuneScape angle units: 2048 units per turn, 512 units per quarter turn.
 * The viewer's camera matches the RS client conventions:
 *   - yaw 0..2047, forward direction is (-sin(yaw - 1024), -cos(yaw - 1024))
 *   - pitch -512..512, where -512 looks straight down and +512 straight up
 *   - position is (x, -height, z) with x/z in tiles and height in tiles
 */
export const UNITS_PER_TURN = 2048;
export const UNITS_PER_QUARTER = 512;
export const UNITS_PER_DEGREE = UNITS_PER_TURN / 360;

export interface Pose {
    x: number;
    z: number;
    /** Tiles above the world plane. */
    height: number;
    yaw: number;
    /** -512 (straight down) .. 512 (straight up). */
    pitch: number;
    /** Vertical field of view in degrees. */
    fov: number;
}

export function normalizeYaw(yaw: number): number {
    return ((yaw % UNITS_PER_TURN) + UNITS_PER_TURN) % UNITS_PER_TURN;
}

/** Yaw that looks along (dx, dz). */
export function yawFromForward(dx: number, dz: number): number {
    return normalizeYaw(1024 + (Math.atan2(-dx, -dz) * UNITS_PER_TURN) / TAU);
}

export function forwardFromYaw(yaw: number): { dx: number; dz: number } {
    const angle = ((yaw - 1024) * TAU) / UNITS_PER_TURN;
    return { dx: -Math.sin(angle), dz: -Math.cos(angle) };
}

/** Downward tilt in degrees -> RS pitch units. */
export function pitchFromTilt(degreesDown: number): number {
    return -degreesDown * UNITS_PER_DEGREE;
}

export function tiltFromPitch(pitch: number): number {
    return (-pitch * 360) / UNITS_PER_TURN;
}

export function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/** Interpolates yaw the short way around the circle. */
export function lerpYaw(a: number, b: number, t: number): number {
    let delta = normalizeYaw(b) - normalizeYaw(a);
    if (delta > UNITS_PER_TURN / 2) {
        delta -= UNITS_PER_TURN;
    } else if (delta < -UNITS_PER_TURN / 2) {
        delta += UNITS_PER_TURN;
    }
    return normalizeYaw(a + delta * t);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
    if (edge0 === edge1) {
        return x < edge0 ? 0 : 1;
    }
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

export function easeInOutSine(t: number): number {
    return -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2;
}

export function distance(ax: number, az: number, bx: number, bz: number): number {
    const dx = bx - ax;
    const dz = bz - az;
    return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Builds a pose that looks at `target` from the given position.
 * `heightOffset` tilts the aim slightly above or below the target.
 */
export function lookAtPose(
    x: number,
    z: number,
    height: number,
    targetX: number,
    targetZ: number,
    targetHeight: number,
    fov: number,
): Pose {
    const dx = targetX - x;
    const dz = targetZ - z;
    const horizontal = Math.max(Math.sqrt(dx * dx + dz * dz), 0.001);
    const degreesDown = (Math.atan2(height - targetHeight, horizontal) * 180) / Math.PI;
    return {
        x,
        z,
        height,
        yaw: yawFromForward(dx, dz),
        pitch: clamp(pitchFromTilt(degreesDown), -512, 0),
        fov,
    };
}

/** Applies a pose to a MapViewer camera. */
export function applyPose(
    camera: { pos: Float32Array | number[]; yaw: number; pitch: number; fov: number; updated: boolean },
    pose: Pose,
): void {
    camera.pos[0] = pose.x;
    camera.pos[1] = -pose.height;
    camera.pos[2] = pose.z;
    camera.yaw = normalizeYaw(pose.yaw);
    camera.pitch = clamp(pose.pitch, -512, 512);
    camera.fov = pose.fov;
    camera.updated = true;
    (camera as any).updatedPosition = true;
}

/** Small deterministic PRNG (mulberry32) so previews are reproducible. */
export function createRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function pick<T>(random: () => number, items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

export function range(random: () => number, min: number, max: number): number {
    return min + random() * (max - min);
}

/** Weighted choice from [item, weight] pairs. */
export function pickWeighted<T>(random: () => number, items: readonly [T, number][]): T {
    let total = 0;
    for (const [, weight] of items) {
        total += weight;
    }
    let roll = random() * total;
    for (const [item, weight] of items) {
        roll -= weight;
        if (roll <= 0) {
            return item;
        }
    }
    return items[items.length - 1][0];
}
