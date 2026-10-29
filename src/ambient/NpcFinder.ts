import { Npc } from "../mapviewer/webgl/npc/Npc";
import { NpcTarget } from "./scenes";
import { Zone } from "./zones";

export interface MapSquareLike {
    mapX: number;
    mapY: number;
    npcs?: Npc[];
}

export type MapSquareLookup = (mapId: number) => MapSquareLike | undefined;

/** getMapSquareId from MapFileIndex, duplicated to keep this module dependency-free. */
function mapId(mapX: number, mapY: number): number {
    return (mapX << 8) | mapY;
}

/** Generic town NPUs and tiny critters make for dull shots. */
const BORING_NAMES = new Set([
    "null",
    "",
    "Banker",
    "Guard",
    "Man",
    "Woman",
    "Rat",
    "Giant rat",
    "Chicken",
    "Seagull",
    "Duck",
    "Butterfly",
    "Cow",
    "Sheep",
    "Rabbit",
    "Pigeon",
    "Squirrel",
    "Frog",
    "Swamp",
    "Crab",
    "Rock Crab",
    "Raven",
    "Baby impling",
]);

interface Candidate {
    npc: Npc;
    mapX: number;
    mapY: number;
    distance: number;
    score: number;
}

/**
 * Finds a wandering NPC near a zone for the "follow an NPC" camera. Prefers big,
 * distinctive NPCs close to the zone centre.
 */
export function findNpcTarget(
    mapSquares: Iterable<MapSquareLike>,
    zone: Zone,
    random: () => number,
    maxDistance = 70,
): NpcTarget | undefined {
    const candidates: Candidate[] = [];

    for (const square of mapSquares) {
        if (!square.npcs || square.npcs.length === 0) {
            continue;
        }

        const squareCenterX = square.mapX * 64 + 32;
        const squareCenterZ = square.mapY * 64 + 32;
        const squareDistance = Math.hypot(squareCenterX - zone.x, squareCenterZ - zone.z);
        if (squareDistance > maxDistance + 48) {
            continue;
        }

        for (const npc of square.npcs) {
            if (npc.level !== 0) {
                continue;
            }

            const name = npc.npcType?.name;
            if (!name || BORING_NAMES.has(name)) {
                continue;
            }

            const worldX = square.mapX * 64 + npc.x / 128;
            const worldZ = square.mapY * 64 + npc.y / 128;
            const distance = Math.hypot(worldX - zone.x, worldZ - zone.z);
            if (distance > maxDistance) {
                continue;
            }

            const size = npc.getSize();
            const npcType = npc.npcType;
            if (npcType.isFollower) {
                continue;
            }
            const score =
                size * 4 +
                (npcType.combatLevel > 0 ? 5 : 0) +
                (1 - distance / maxDistance) * 5 +
                random() * 3;

            candidates.push({ npc, mapX: square.mapX, mapY: square.mapY, distance, score });
        }
    }

    if (candidates.length === 0) {
        return undefined;
    }

    candidates.sort((a, b) => b.score - a.score);
    // Pick from the best few so repeated scenes in one zone still vary.
    const best = candidates[Math.floor(random() * Math.min(5, candidates.length))];

    return createTarget(best, zone);
}

function createTarget(
    candidate: Candidate,
    zone: Zone,
): NpcTarget {
    const { npc, mapX, mapY } = candidate;
    const spawnX = npc.spawnX;
    const spawnY = npc.spawnY;
    const name = npc.npcType?.name ?? zone.name;

    return {
        name,
        position(): { x: number; z: number } | undefined {
            const dx = npc.x / 128;
            const dz = npc.y / 128;
            if (!Number.isFinite(dx) || !Number.isFinite(dz)) {
                return undefined;
            }
            return { x: mapX * 64 + dx, z: mapY * 64 + dz };
        },
        // Extra fields used for diagnostics.
        ...({ spawnX, spawnY } as any),
    };
}

export function mapSquareFor(
    lookup: MapSquareLookup,
    tileX: number,
    tileZ: number,
): MapSquareLike | undefined {
    return lookup(mapId(tileX >> 6, tileZ >> 6));
}
