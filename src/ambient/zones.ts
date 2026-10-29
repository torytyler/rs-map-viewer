/**
 * Curated places for the ambient camera. Hand-picked for how good they look from
 * a moving camera: recognisable landmarks, varied biomes, some dungeons.
 *
 * x/z are OSRS tile coordinates, `radius` is roughly how much interesting terrain
 * surrounds the spot (in tiles) and `height` is a good camera height for it.
 */
export interface Zone {
    name: string;
    x: number;
    z: number;
    /** Radius of interesting terrain in tiles. */
    radius: number;
    /** Preferred cruising camera height in tiles. */
    height: number;
    /** Extra tags; "underground" zones keep the camera low. */
    tags?: string[];
}

function zone(
    name: string,
    x: number,
    z: number,
    radius: number,
    height: number,
    tags?: string[],
): Zone {
    return { name, x, z, radius, height, tags };
}

export const ZONES: Zone[] = [
    // Kingdom of Misthalin
    zone("Lumbridge", 3222, 3218, 45, 30),
    zone("Lumbridge Castle", 3223, 3218, 18, 16),
    zone("Lumbridge Swamp", 3170, 3165, 40, 26),
    zone("Draynor Village", 3093, 3244, 35, 24),
    zone("Draynor Manor", 3110, 3356, 30, 30),
    zone("Wizards' Tower", 3107, 3164, 22, 22),
    zone("Varrock Square", 3212, 3424, 32, 24),
    zone("Varrock Palace", 3205, 3490, 26, 26),
    zone("Grand Exchange", 3164, 3483, 22, 20),
    zone("Edgeville", 3093, 3494, 28, 22),
    zone("Barbarian Village", 3084, 3421, 30, 24),
    zone("Digsite", 3355, 3330, 40, 30),
    zone("Ruins of Camdozaal", 2960, 3400, 35, 26, ["underground"]),

    // Asgarnia
    zone("Falador", 2965, 3380, 40, 26),
    zone("Falador Park", 2998, 3375, 20, 18),
    zone("Taverley", 2897, 3443, 32, 26),
    zone("Burthorpe", 2895, 3550, 32, 28),
    zone("Trollheim", 2860, 3660, 60, 50),
    zone("Port Sarim", 3024, 3210, 30, 24),
    zone("Rimmington", 2955, 3210, 30, 24),
    zone("Asgarnian Ice Dungeon", 3038, 9580, 24, 18, ["underground"]),
    zone("Ice Mountain", 3008, 3475, 30, 26),

    // Kharidian Desert
    zone("Al Kharid", 3293, 3151, 32, 24),
    zone("Duel Arena", 3328, 3238, 26, 22),
    zone("Shantay Pass", 3300, 3130, 26, 22),
    zone("Pollnivneach", 3355, 2960, 34, 26),
    zone("Nardah", 3420, 2916, 30, 24),
    zone("Sophanem", 3296, 2784, 34, 26),
    zone("Ruins of Uzer", 3480, 3090, 30, 24),
    zone("Agility Pyramid", 3364, 2840, 26, 24),

    // Kandarin
    zone("Ardougne", 2662, 3303, 40, 26),
    zone("East Ardougne Market", 2663, 3283, 18, 16),
    zone("Catherby", 2810, 3438, 30, 24),
    zone("Camelot", 2758, 3479, 30, 26),
    zone("Seers' Village", 2725, 3493, 30, 24),
    zone("Yanille", 2607, 3100, 30, 24),
    zone("Tree Gnome Stronghold", 2450, 3420, 45, 34),
    zone("Tree Gnome Village", 2540, 3165, 32, 26),
    zone("Baxtorian Falls", 2530, 3510, 40, 34),
    zone("Castle Wars", 2440, 3090, 30, 26),
    zone("Feldip Hills", 2570, 2960, 60, 40),
    zone("Corsair Cove", 2580, 2810, 36, 28),

    // Karamja
    zone("Brimhaven", 2760, 3170, 32, 24),
    zone("Tai Bwo Wannai", 2790, 3050, 36, 28),
    zone("Shilo Village", 2860, 2950, 34, 26),
    zone("Kharazi Jungle", 2830, 2920, 50, 36),

    // Morytania
    zone("Canifis", 3490, 3480, 30, 24),
    zone("Mort'ton", 3500, 3290, 34, 26),
    zone("Barrows", 3560, 3305, 30, 26),
    zone("Meiyerditch", 3620, 3230, 40, 30),
    zone("Darkmeyer", 3630, 3360, 34, 26),
    zone("Mos Le'Harmless", 3700, 3010, 34, 26),
    zone("Slepe", 3700, 3370, 34, 28),

    // Fremennik & the north
    zone("Miscellania", 2520, 3860, 34, 26),
    zone("Etceteria", 2600, 3870, 26, 22),
    zone("Neitiznot", 2320, 3800, 30, 24),
    zone("Jatizso", 2400, 3800, 30, 24),
    zone("Lunar Isle", 2110, 3910, 40, 30),
    zone("Weiss", 2850, 3960, 40, 34),
    zone("Wintertodt", 1630, 3990, 44, 34),

    // Great Kourend
    zone("Hosidius", 1730, 3570, 40, 28),
    zone("Arceuus", 1700, 3750, 40, 30),
    zone("Lovakengj", 1530, 3730, 40, 30),
    zone("Shayzien", 1490, 3630, 40, 28),
    zone("Piscarilius", 1830, 3690, 40, 28),
    zone("Mount Karuulm", 1310, 3800, 50, 40),

    // Tirannwn & the elven lands
    zone("Prifddinas", 3260, 6100, 55, 34),
    zone("Lletya", 2320, 3170, 32, 26),
    zone("Zul-Andra", 2200, 3050, 30, 24),

    // Islands & other planes
    zone("Ape Atoll", 2750, 2750, 44, 32),
    zone("Fossil Island", 3750, 3860, 60, 42),
    zone("Isle of Souls", 2200, 2900, 50, 36),
    zone("Zanaris", 2400, 4440, 44, 32, ["underground"]),
    zone("Keldagrim", 2850, 10200, 45, 30, ["underground"]),
    zone("Dorgesh-Kaan", 2700, 5300, 45, 30, ["underground"]),
    zone("Tutorial Island", 3090, 3090, 30, 24),
];

/**
 * Places that exist in the 2005 cache (rs2-295). The historical world is much
 * smaller than modern OSRS, so the legacy era sticks to these.
 */
export const LEGACY_ZONE_NAMES = new Set([
    "Lumbridge",
    "Lumbridge Castle",
    "Lumbridge Swamp",
    "Draynor Village",
    "Draynor Manor",
    "Wizards' Tower",
    "Varrock Square",
    "Varrock Palace",
    "Edgeville",
    "Barbarian Village",
    "Digsite",
    "Falador",
    "Falador Park",
    "Taverley",
    "Burthorpe",
    "Trollheim",
    "Port Sarim",
    "Rimmington",
    "Asgarnian Ice Dungeon",
    "Ice Mountain",
    "Al Kharid",
    "Duel Arena",
    "Shantay Pass",
    "Pollnivneach",
    "Nardah",
    "Sophanem",
    "Ruins of Uzer",
    "Agility Pyramid",
    "Ardougne",
    "East Ardougne Market",
    "Catherby",
    "Camelot",
    "Seers' Village",
    "Yanille",
    "Tree Gnome Stronghold",
    "Tree Gnome Village",
    "Baxtorian Falls",
    "Castle Wars",
    "Feldip Hills",
    "Brimhaven",
    "Tai Bwo Wannai",
    "Shilo Village",
    "Kharazi Jungle",
    "Canifis",
    "Mort'ton",
    "Barrows",
    "Miscellania",
    "Etceteria",
    "Zanaris",
    "Keldagrim",
    "Tutorial Island",
    "Ape Atoll",
]);

export function zonesForEra(era: "latest" | "legacy"): Zone[] {
    if (era === "legacy") {
        return ZONES.filter((zone) => LEGACY_ZONE_NAMES.has(zone.name));
    }
    return ZONES;
}

export function findZone(name: string): Zone | undefined {
    const needle = name.toLowerCase();
    return ZONES.find((zone) => zone.name.toLowerCase() === needle);
}

/**
 * Picks a follow-up zone that is a comfortable flight away from the current one.
 * Prefers 150-900 tiles so the camera actually travels somewhere, then falls back
 * to anything in range.
 */
export function pickNeighbour(
    random: () => number,
    current: Zone | undefined,
    minDistance: number,
    maxDistance: number,
    exclude: Set<string>,
    allowed: Zone[] = ZONES,
): Zone | undefined {
    if (!current) {
        return undefined;
    }

    const candidates = allowed.filter((zone) => {
        if (exclude.has(zone.name) || zone.name === current.name) {
            return false;
        }
        const dx = zone.x - current.x;
        const dz = zone.z - current.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        return dist >= minDistance && dist <= maxDistance;
    });

    if (candidates.length === 0) {
        return undefined;
    }
    return candidates[Math.floor(random() * candidates.length)];
}

export function nearestZones(current: Zone, maxDistance: number): Zone[] {
    return ZONES.filter((zone) => {
        if (zone.name === current.name) {
            return false;
        }
        const dx = zone.x - current.x;
        const dz = zone.z - current.z;
        return Math.sqrt(dx * dx + dz * dz) <= maxDistance;
    });
}
