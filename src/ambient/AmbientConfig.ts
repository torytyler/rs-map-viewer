import { AmbientOptions } from "./AmbientDirector";
import { clamp } from "./cameraMath";
import { findZone } from "./zones";

function numberParam(params: URLSearchParams, name: string, fallback: number): number {
    const raw = params.get(name);
    if (raw === null || raw.trim() === "") {
        return fallback;
    }
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
}

function boolParam(params: URLSearchParams, name: string, fallback: boolean): boolean {
    const raw = params.get(name);
    if (raw === null) {
        return fallback;
    }
    return raw !== "0" && raw.toLowerCase() !== "false" && raw !== "";
}

const DISABLED = new Set(["0", "false", "off", "no"]);

function parseEra(raw: string | null): "latest" | "legacy" | "mixed" {
    switch ((raw ?? "").toLowerCase()) {
        case "latest":
        case "current":
        case "osrs":
            return "latest";
        case "legacy":
        case "2005":
        case "rs2":
            return "legacy";
        default:
            return "mixed";
    }
}

/**
 * Ambient (screen saver) mode is opt-in through the URL:
 *
 *   ?ambient=1                 random zone rotation
 *   ?ambient=Lumbridge         stick to a named zone
 *   &dwell=30                  seconds per scene
 *   &fade=1                    cross-fade duration
 *   &fps=30                    frame cap
 *   &distance=160              render distance in tiles
 *   &npc=0.5                   chance of following an NPC
 *   &minflight=140&maxflight=900  flight distance window, outside it we cut
 *   &labels=0&debug=1&seed=42
 */
export function parseAmbientOptions(params: URLSearchParams): AmbientOptions | undefined {
    const ambient = params.get("ambient");
    if (ambient === null || DISABLED.has(ambient.toLowerCase()) || ambient === "") {
        return undefined;
    }

    const named = findZone(ambient);
    const explicitZone = params.get("zone");

    // The System Settings preview pane runs on a tiny window; keep it cheap.
    const preview = boolParam(params, "preview", false);
    const renderDistance = clamp(numberParam(params, "distance", preview ? 192 : 320), 64, 512);
    const fps = clamp(numberParam(params, "fps", preview ? 20 : 24), 5, 120);

    return {
        dwellSeconds: clamp(numberParam(params, "dwell", 30), 5, 900),
        fadeSeconds: clamp(numberParam(params, "fade", 1), 0.1, 5),
        seed: Math.floor(numberParam(params, "seed", Math.random() * 2 ** 31)),
        labels: boolParam(params, "labels", true),
        debug: boolParam(params, "debug", false),
        fps,
        renderDistance,
        fogDepth: clamp(numberParam(params, "fog", 96), 0, 256),
        skyColor: Math.round(clamp(numberParam(params, "sky", 0x000000), 0, 0xffffff)),
        maxFlightDistance: clamp(numberParam(params, "maxflight", 950), 0, 5000),
        minFlightDistance: clamp(numberParam(params, "minflight", 140), 0, 5000),
        npcChance: clamp(numberParam(params, "npc", 0.5), 0, 1),
        era: parseEra(params.get("era")),
        eraEvery: Math.round(clamp(numberParam(params, "eraevery", 4), 1, 50)),
        forceZone: named?.name ?? explicitZone ?? undefined,
    };
}
