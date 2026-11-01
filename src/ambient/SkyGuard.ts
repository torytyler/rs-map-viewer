import { MapManager } from "../mapviewer/MapManager";
import { Scene } from "../rs/scene/Scene";
import { Pose, clamp, pitchFromTilt, tiltFromPitch } from "./cameraMath";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Slack above the geometric horizon line, in degrees, so one pixel of sky never survives. */
const HORIZON_MARGIN = 2.5;

/** The camera never zooms in further than this, even if that means some sky. */
const FOV_MIN = 14;
/** Sanity cap: the guard may widen the shot, never past this. */
const FOV_MAX = 72;
/** Steepest tilt we are willing to force, in degrees below horizontal. */
const TILT_MAX = 74;

/** Slew limits keep the correction smooth instead of snapping between poses. */
const FOV_SLEW_PER_SECOND = 9;
const TILT_SLEW_PER_SECOND = 7;

/** Footprint probe resolution: lateral columns x radial rings. */
const COLUMNS = 13;
const RINGS = 5;

export interface TerrainLookup {
    /** True when the map square containing (x, z) has terrain to render. */
    isMapped(x: number, z: number): boolean;
}

export interface SkyGuardState {
    /** Effective vertical FOV in degrees. */
    fov: number;
    /** Effective downward tilt in degrees. */
    tilt: number;
    /** Minimum tilt this height demands. */
    requiredTilt: number;
    /** Furthest ground distance visible through the top of the frame, in tiles. */
    farEdge: number;
    /** True when the whole footprint sits on mapped terrain inside the safe radius. */
    clean: boolean;
}

/**
 * Keeps unfilled space out of frame.
 *
 * The renderer has no skybox: anything the camera sees that is not a loaded map
 * square — the space above the horizon, everything past the streamed terrain, and
 * the holes and ragged edges in the map data itself — is the clear colour. This
 * class trims the shot so that does not happen:
 *
 *  - the top edge of the frame is pushed below the horizon by tilting down, and
 *  - the ground distance visible through that top edge is kept inside
 *    `safeRadius`, and the whole footprint on mapped squares, by narrowing the
 *    vertical FOV.
 *
 * Only the vertical axis drives the geometry: a sideways ray keeps the camera
 * axis' downward angle, so the top-centre ray is always both the shallowest and
 * the farthest one. Horizontal extent still matters for the terrain probe, since
 * map data ends at square boundaries on the sides too.
 *
 * Both corrections are rate limited, so a scene eases into and out of the
 * constraint instead of jumping.
 */
export class SkyGuard {
    private fov?: number;
    private tilt?: number;
    private state: SkyGuardState;
    private prefetch: Array<{ x: number; z: number }> = [];

    constructor(
        private readonly terrain: TerrainLookup,
        /** Terrain is only reliably streamed this far around the camera, in tiles. */
        private readonly safeRadius: number,
    ) {
        this.state = { fov: 60, tilt: 40, requiredTilt: 0, farEdge: 0, clean: true };
    }

    get debugState(): SkyGuardState {
        return { ...this.state };
    }

    /**
     * Ground points just beyond the visible footprint. The map manager only
     * queues squares that are already inside the frustum, so without this the far
     * edge spends a second as a hole while flying — which the guard would then try
     * to zoom away from.
     */
    get edgePrefetchPoints(): ReadonlyArray<{ x: number; z: number }> {
        return this.prefetch;
    }

    /** Applies the constraint instantly (used after a teleport / scene cut). */
    snapTo(pose: Pose, aspect: number): Pose {
        const solved = this.solve(pose, aspect);
        this.fov = solved.fov;
        this.tilt = solved.tilt;
        this.state = solved.state;
        return this.output(pose, solved.fov, solved.tilt);
    }

    /** Eases the camera toward a pose that only shows mapped terrain. */
    guard(pose: Pose, aspect: number, deltaTime: number): Pose {
        const solved = this.solve(pose, aspect);

        this.fov = slew(this.fov ?? solved.fov, solved.fov, FOV_SLEW_PER_SECOND, deltaTime);
        this.tilt = slew(this.tilt ?? solved.tilt, solved.tilt, TILT_SLEW_PER_SECOND, deltaTime);
        this.state = solved.state;

        return this.output(pose, this.fov, this.tilt);
    }

    /** What the guard would do with this pose, without changing its own state. */
    inspect(pose: Pose, aspect: number): SkyGuardState {
        const savedFov = this.fov;
        const savedTilt = this.tilt;
        const savedPrefetch = this.prefetch;
        const { state } = this.solve(pose, aspect);
        this.fov = savedFov;
        this.tilt = savedTilt;
        this.prefetch = savedPrefetch;
        return state;
    }

    // MARK: - Solving

    private solve(pose: Pose, aspect: number): { fov: number; tilt: number; state: SkyGuardState } {
        // Camera height above the ground plane. Terrain elevation only makes the
        // real footprint smaller, so the plane is a safe assumption.
        const height = Math.max(pose.height, 4);

        // Downward angle of the top-centre ray needed to land within safeRadius.
        const requiredTop = Math.atan(height / this.safeRadius) * RAD + HORIZON_MARGIN;

        let fov = clamp(pose.fov, FOV_MIN, FOV_MAX);
        let tilt = Math.max(tiltFromPitch(pose.pitch), fov / 2 + requiredTop);

        if (tilt > TILT_MAX) {
            // Not enough tilt budget: narrow the shot until the top edge fits.
            tilt = TILT_MAX;
            fov = Math.min(fov, Math.max(FOV_MIN, 2 * (TILT_MAX - requiredTop)));
        }

        // Shrink while that actually removes unmapped samples. A hole close to the
        // camera cannot be framed away, so stop as soon as tightening stops
        // helping instead of collapsing the shot.
        let unmapped = this.countUnmapped(pose, height, fov, tilt, aspect);
        for (let step = 0; step < 9 && unmapped > 0 && fov > FOV_MIN + 0.5; step++) {
            const candidate = Math.max(FOV_MIN, Math.min(fov * 0.86, fov - 1.5));
            const remaining = this.countUnmapped(pose, height, candidate, tilt, aspect);
            if (remaining >= unmapped) {
                break;
            }
            fov = candidate;
            unmapped = remaining;
        }
        fov = clamp(fov, FOV_MIN, FOV_MAX);

        const topAngle = (tilt - fov / 2) * DEG;
        const farEdge = topAngle > 0 ? height / Math.tan(topAngle) : Number.POSITIVE_INFINITY;

        this.prefetch = this.footprint(pose, height, fov, tilt, aspect, 1.12);

        return {
            fov,
            tilt,
            state: {
                fov,
                tilt,
                requiredTilt: fov / 2 + requiredTop,
                farEdge,
                clean: unmapped === 0,
            },
        };
    }

    /** How many footprint samples sit on terrain that cannot be rendered. */
    private countUnmapped(
        pose: Pose,
        height: number,
        fov: number,
        tilt: number,
        aspect: number,
    ): number {
        const points = this.footprint(pose, height, fov, tilt, aspect, 1);
        if (points.length === 0) {
            return Number.MAX_SAFE_INTEGER;
        }
        let unmapped = 0;
        for (const point of points) {
            if (!this.terrain.isMapped(point.x, point.z)) {
                unmapped += 1;
            }
        }
        return unmapped;
    }

    /**
     * Ground points covering the frame: every visible column at several distances
     * between the camera and the far (top) edge. The outer ring is what keeps the
     * horizon out; the inner rings catch holes and the ragged edge of the map data,
     * which otherwise show up as void at the sides of the frame.
     *
     * `scale` pushes the samples outward, which the prefetch uses to queue squares
     * just before they come into view.
     */
    private footprint(
        pose: Pose,
        height: number,
        fov: number,
        tilt: number,
        aspect: number,
        scale: number,
    ): Array<{ x: number; z: number }> {
        const halfFov = fov / 2;
        const topAngle = (tilt - halfFov) * DEG;
        const bottomAngle = Math.min(tilt + halfFov, 89.5) * DEG;
        if (topAngle <= 0.25 * DEG) {
            return [];
        }

        const far = height / Math.tan(topAngle);
        const near = height / Math.tan(bottomAngle);
        if (!Number.isFinite(far) || far <= 0) {
            return [];
        }

        // Where the bottom of the frame meets the ground, as a fraction of `far`.
        const startRatio = clamp(near / far, 0.02, 0.85);
        const halfWidthTan = Math.tan(halfFov * DEG) * Math.max(aspect, 0.5);

        const yawRadians = ((pose.yaw - 1024) * Math.PI * 2) / 2048;
        const forwardX = -Math.sin(yawRadians);
        const forwardZ = -Math.cos(yawRadians);
        const rightX = forwardZ;
        const rightZ = -forwardX;

        const points: Array<{ x: number; z: number }> = [];
        for (let ring = 0; ring < RINGS; ring++) {
            const ratio = startRatio + ((1 - startRatio) * ring) / (RINGS - 1);
            const distance = far * ratio * scale;
            const halfWidth = distance * halfWidthTan;
            for (let column = 0; column < COLUMNS; column++) {
                const offset = (-1 + (2 * column) / (COLUMNS - 1)) * halfWidth;
                points.push({
                    x: pose.x + forwardX * distance + rightX * offset,
                    z: pose.z + forwardZ * distance + rightZ * offset,
                });
            }
        }
        return points;
    }

    private output(pose: Pose, fov: number, tilt: number): Pose {
        return { ...pose, pitch: clamp(pitchFromTilt(tilt), -512, 0), fov };
    }
}

/** Moves `current` toward `target` at most `ratePerSecond * deltaTime`. */
function slew(current: number, target: number, ratePerSecond: number, deltaTime: number): number {
    const limit = Math.max(ratePerSecond * Math.max(deltaTime, 0), 0.01);
    const delta = target - current;
    if (Math.abs(delta) <= limit) {
        return target;
    }
    return current + Math.sign(delta) * limit;
}

/** The slice of MapManager the guard needs (keeps this file free of generics). */
export interface MapSquareRegistry {
    invalidMapIds: Set<number>;
}

/** Terrain lookup backed by the renderer's map manager. */
export function createTerrainLookup(mapManager: MapSquareRegistry): TerrainLookup {
    return {
        isMapped(x: number, z: number): boolean {
            const mapX = Math.floor(x / Scene.MAP_SQUARE_SIZE);
            const mapY = Math.floor(z / Scene.MAP_SQUARE_SIZE);
            if (mapX < 0 || mapY < 0 || mapX >= MapManager.MAX_MAP_X || mapY >= MapManager.MAX_MAP_Y) {
                return false;
            }
            return !mapManager.invalidMapIds.has((mapX << 8) | mapY);
        },
    };
}
