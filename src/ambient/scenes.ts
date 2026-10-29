import { TAU } from "../rs/MathConstants";
import {
    Pose,
    clamp,
    easeInOutSine,
    lerp,
    lerpYaw,
    lookAtPose,
    normalizeYaw,
    pickWeighted,
    pitchFromTilt,
    range,
    smoothstep,
    yawFromForward,
} from "./cameraMath";
import { Zone } from "./zones";

export type MotionKind = "orbit" | "pan" | "drift" | "push" | "npc";

const DEGREE = TAU / 360;

export interface NpcTarget {
    name: string;
    /** Live world position in tiles, or undefined when the NPC is gone. */
    position(): { x: number; z: number } | undefined;
}

export interface Scene {
    kind: MotionKind;
    zone: Zone;
    label: string;
    npc?: NpcTarget;
    poseAt(time: number): Pose;
}

/**
 * A camera pose looking at the zone centre from a random direction. This is where
 * a flight lands and where the following scene starts, so every scene begins
 * exactly on the landing pose (no cut on arrival).
 */
export function zoneLandingPose(zone: Zone, random: () => number): Pose {
    const angle = range(random, 0, TAU);
    const height = zone.height * range(random, 0.75, 1.15);
    // Frame the way the game would: a 28-46 degree downward tilt, standing back
    // far enough that the zone fills the shot instead of looking straight down on it.
    const tilt = range(random, 28, 46);
    const radius = clamp(
        height / Math.tan((tilt * Math.PI) / 180),
        zone.radius * 0.2,
        zone.radius * 1.1,
    );
    const fov = range(random, 50, 64);
    return lookAtPose(
        zone.x + Math.cos(angle) * radius,
        zone.z + Math.sin(angle) * radius,
        height,
        zone.x,
        zone.z,
        0,
        fov,
    );
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
    return {
        x: lerp(a.x, b.x, t),
        z: lerp(a.z, b.z, t),
        height: lerp(a.height, b.height, t),
        yaw: lerpYaw(a.yaw, b.yaw, t),
        pitch: lerp(a.pitch, b.pitch, t),
        fov: lerp(a.fov, b.fov, t),
    };
}

/**
 * Builds one dwell-scene for a zone. `entry` is the pose the scene must start on;
 * every motion is a pure function of the time since arrival.
 */
export function createScene(
    zone: Zone,
    random: () => number,
    duration: number,
    entry: Pose,
    npc?: NpcTarget,
): Scene {
    if (npc) {
        return createNpcScene(zone, random, entry, npc);
    }

    const kind = pickWeighted<MotionKind>(random, [
        ["orbit", 3],
        ["pan", 2],
        ["drift", 2],
        ["push", 1.6],
    ]);

    switch (kind) {
        case "pan":
            return createPanScene(zone, random, duration, entry);
        case "drift":
            return createDriftScene(zone, random, duration, entry);
        case "push":
            return createPushScene(zone, random, duration, entry);
        default:
            return createOrbitScene(zone, random, duration, entry);
    }
}

function createOrbitScene(
    zone: Zone,
    random: () => number,
    duration: number,
    entry: Pose,
): Scene {
    const centerX = zone.x + range(random, -0.18, 0.18) * zone.radius;
    const centerZ = zone.z + range(random, -0.18, 0.18) * zone.radius;
    const radius = Math.max(Math.hypot(entry.x - centerX, entry.z - centerZ), 6);
    const startAngle = Math.atan2(entry.z - centerZ, entry.x - centerX);
    const height = entry.height;
    const fov = entry.fov;
    // A third to a full sweep during the dwell, either direction.
    const sweep = range(random, 0.3, 1.0) * TAU * (random() < 0.5 ? -1 : 1);
    const radiansPerSecond = sweep / Math.max(duration, 1);
    const bob = range(random, 0.03, 0.08);
    const wobble = range(random, 6, 16) * DEGREE;

    return {
        kind: "orbit",
        zone,
        label: zone.name,
        poseAt(time: number): Pose {
            const angle = startAngle + radiansPerSecond * time;
            const h = height * (1 + bob * Math.sin(time * 0.13));
            const pose = lookAtPose(
                centerX + Math.cos(angle) * radius,
                centerZ + Math.sin(angle) * radius,
                h,
                centerX,
                centerZ,
                0,
                fov,
            );
            pose.yaw = normalizeYaw(pose.yaw + Math.sin(time * 0.11) * wobble);
            return pose;
        },
    };
}

function createPanScene(
    zone: Zone,
    random: () => number,
    duration: number,
    entry: Pose,
): Scene {
    const sweep = range(random, 20, 55) * DEGREE * (random() < 0.5 ? -1 : 1);

    return {
        kind: "pan",
        zone,
        label: zone.name,
        poseAt(time: number): Pose {
            const k = Math.sin((time / Math.max(duration, 1)) * Math.PI);
            return {
                x: entry.x,
                z: entry.z,
                height: entry.height + Math.sin(time * 0.17) * entry.height * 0.02,
                yaw: normalizeYaw(entry.yaw + sweep * k),
                pitch: entry.pitch + Math.sin(time * 0.09) * 14,
                fov: entry.fov,
            };
        },
    };
}

function createDriftScene(
    zone: Zone,
    random: () => number,
    duration: number,
    entry: Pose,
): Scene {
    const heading = ((entry.yaw - 1024) * TAU) / 2048;
    const forward = { dx: -Math.sin(heading), dz: -Math.cos(heading) };
    const speed = range(random, 1.4, 3.2);
    const yawDrift = range(random, -5, 5) * DEGREE;
    const pitch = Math.min(entry.pitch, pitchFromTilt(20));

    return {
        kind: "drift",
        zone,
        label: zone.name,
        poseAt(time: number): Pose {
            const travelled = speed * Math.min(time, duration * 1.2);
            return {
                x: entry.x + forward.dx * travelled,
                z: entry.z + forward.dz * travelled,
                height: entry.height + Math.sin(time * 0.21) * 1.2,
                yaw: normalizeYaw(entry.yaw + yawDrift * Math.sin(time * 0.05)),
                pitch,
                fov: entry.fov,
            };
        },
    };
}

function createPushScene(
    zone: Zone,
    random: () => number,
    duration: number,
    entry: Pose,
): Scene {
    const targetX = zone.x + range(random, -0.15, 0.15) * zone.radius;
    const targetZ = zone.z + range(random, -0.15, 0.15) * zone.radius;
    const startDistance = Math.max(Math.hypot(entry.x - targetX, entry.z - targetZ), 10);
    const endDistance = startDistance * range(random, 0.5, 0.78);
    const startHeight = entry.height;
    const endHeight = Math.max(startHeight * range(random, 0.6, 0.85), 4);

    return {
        kind: "push",
        zone,
        label: zone.name,
        poseAt(time: number): Pose {
            const k = easeInOutSine(clamp(time / Math.max(duration, 1), 0, 1));
            const distance = startDistance + (endDistance - startDistance) * k;
            const height = startHeight + (endHeight - startHeight) * k;
            const angle = Math.atan2(entry.z - targetZ, entry.x - targetX);
            return lookAtPose(
                targetX + Math.cos(angle) * distance,
                targetZ + Math.sin(angle) * distance,
                height,
                targetX,
                targetZ,
                0,
                entry.fov,
            );
        },
    };
}

function createNpcScene(zone: Zone, random: () => number, entry: Pose, npc: NpcTarget): Scene {
    const radius = range(random, 5.5, 10);
    const height = radius * range(random, 0.75, 1.15);
    const startAngle = Math.atan2(entry.z - zone.z, entry.x - zone.x);
    const angularSpeed = range(random, 1.2, 3.6) * DEGREE * (random() < 0.5 ? -1 : 1);
    const fov = clamp(entry.fov - 4, 45, 60);
    const settleSeconds = 3;

    const follow = (position: { x: number; z: number }, angle: number, time: number): Pose =>
        lookAtPose(
            position.x + Math.cos(angle) * radius,
            position.z + Math.sin(angle) * radius,
            height + Math.sin(time * 0.23) * 0.35,
            position.x,
            position.z,
            0.9,
            fov,
        );

    return {
        kind: "npc",
        zone,
        label: npc.name,
        npc,
        poseAt(time: number): Pose {
            const position = npc.position();
            if (!position) {
                return entry;
            }
            const angle = startAngle + angularSpeed * time;
            const pose = follow(position, angle, time);
            // Ease out of the landing pose into the follow shot.
            return lerpPose(entry, pose, smoothstep(0, settleSeconds, time));
        },
    };
}

// MARK: - Flights

export interface Flight {
    from: Pose;
    to: Pose;
    zone: Zone;
    duration: number;
    controlX: number;
    controlZ: number;
    peakHeight: number;
    flightPitch: number;
}

/**
 * Plans a cinematic flight between two zones: a curved ground track with an
 * altitude arc that turns out of the previous shot, follows the path and settles
 * onto the destination framing right before arrival.
 */
export function createFlight(from: Pose, to: Pose, zone: Zone, random: () => number): Flight {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    const bend = clamp(distance * range(random, -0.14, 0.14), -130, 130);
    const nx = distance > 0 ? -dz / distance : 0;
    const nz = distance > 0 ? dx / distance : 0;

    const speed = range(random, 32, 50);
    const duration = clamp(distance / speed, 5.5, 26);

    return {
        from,
        to,
        zone,
        duration,
        controlX: (from.x + to.x) / 2 + nx * bend,
        controlZ: (from.z + to.z) / 2 + nz * bend,
        peakHeight: clamp(distance * 0.2, 26, 150),
        flightPitch: pitchFromTilt(range(random, 30, 44)),
    };
}

function quadratic(a: number, b: number, c: number, t: number): number {
    const inv = 1 - t;
    return inv * inv * a + 2 * inv * t * b + t * t * c;
}

function quadraticDerivative(a: number, b: number, c: number, t: number): number {
    return 2 * (1 - t) * (b - a) + 2 * t * (c - b);
}

function shortestDelta(from: number, to: number): number {
    let delta = normalizeYaw(to) - normalizeYaw(from);
    if (delta > 1024) {
        delta -= 2048;
    } else if (delta < -1024) {
        delta += 2048;
    }
    return delta;
}

export function flightPoseAt(flight: Flight, progress: number): Pose {
    const t = clamp(progress, 0, 1);
    const x = quadratic(flight.from.x, flight.controlX, flight.to.x, t);
    const z = quadratic(flight.from.z, flight.controlZ, flight.to.z, t);

    const baseHeight = flight.from.height + (flight.to.height - flight.from.height) * t;
    const height = baseHeight + Math.sin(Math.PI * t) * flight.peakHeight;

    const tangentX = quadraticDerivative(flight.from.x, flight.controlX, flight.to.x, t);
    const tangentZ = quadraticDerivative(flight.from.z, flight.controlZ, flight.to.z, t);
    const travelYaw = yawFromForward(tangentX, tangentZ);

    const startBlend = smoothstep(0, 0.14, t);
    const endBlend = smoothstep(0.7, 1, t);

    let yaw = flight.from.yaw + shortestDelta(flight.from.yaw, travelYaw) * startBlend;
    yaw += shortestDelta(yaw, flight.to.yaw) * endBlend;

    const pitch =
        (flight.from.pitch + (flight.flightPitch - flight.from.pitch) * startBlend) *
            (1 - endBlend) +
        flight.to.pitch * endBlend;

    const fov =
        flight.from.fov + (flight.to.fov - flight.from.fov) * t + Math.sin(Math.PI * t) * 6;

    return { x, z, height, yaw: normalizeYaw(yaw), pitch, fov };
}
