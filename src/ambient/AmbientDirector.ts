import { MapViewer } from "../mapviewer/MapViewer";
import { AmbientOverlay } from "./AmbientOverlay";
import {
    Pose,
    PoseSmoother,
    applyPose,
    createRandom,
    distance,
    forwardFromYaw,
    pick,
    smoothstep,
} from "./cameraMath";
import { MapSquareLike, findNpcTarget } from "./NpcFinder";
import {
    Flight,
    Scene,
    createFlight,
    createScene,
    flightPoseAt,
    zoneLandingPose,
} from "./scenes";
import { ZONES, Zone, pickNeighbour, zonesForEra } from "./zones";

export interface AmbientOptions {
    /** Seconds spent parked in a scene before moving on. */
    dwellSeconds: number;
    /** Seconds for a cross-fade cut. */
    fadeSeconds: number;
    seed: number;
    labels: boolean;
    debug: boolean;
    fps: number;
    renderDistance: number;
    /** Fly to the next zone when it is at most this many tiles away. */
    maxFlightDistance: number;
    /** Zones closer than this are cut to instead (avoid pointless hops). */
    minFlightDistance: number;
    /** Probability of following an NPC instead of a landscape shot. */
    npcChance: number;
    /** Force a single zone (debug). */
    forceZone?: string;
    /** Fog band at the edge of the render distance, in tiles. */
    fogDepth: number;
    /** Sky colour as 0xRRGGBB. */
    skyColor: number;
    /** Era rotation: "latest" | "legacy" | "mixed" (default "mixed"). */
    era?: "latest" | "legacy" | "mixed";
    /** Cache name of the current era. */
    latestCache?: string;
    /** Cache name of the historical era. */
    legacyCache?: string;
    /** Zones between era switches (default 4). */
    eraEvery?: number;
    /** Provided by the app: loads another cache into the running viewer. */
    switchEra?: (cacheName: string) => Promise<boolean>;
}

type Phase = "idle" | "fade-out" | "black" | "dwell" | "flight";

const RECENT_ZONE_MEMORY = 8;

/**
 * Drives the camera for the screen saver: pick a zone, fly there (or cut), hold a
 * slow cinematic move for a while, repeat. Everything is time based and analytic,
 * so it never accumulates drift and the 30s dwell only starts once we have arrived.
 */
export class AmbientDirector {
    private readonly random: () => number;
    private readonly overlay: AmbientOverlay;
    private readonly smoother = new PoseSmoother(0.14);

    private phase: Phase = "idle";
    private phaseTime = 0;

    private scene?: Scene;
    private flight?: Flight;
    private currentZone?: Zone;
    private pendingZone?: Zone;
    private pendingLanding?: Pose;

    private lastPose?: Pose;
    private fadeIn = false;
    private recentZones: string[] = [];
    private debugAccumulator = 0;
    private prefetchAccumulator = 0;
    private eraSwitchTarget?: "latest" | "legacy";
    private npcLostTime = 0;
    private blackTime = 0;
    private lastDeltaTime = 1 / 30;

    private readonly eraMode: "latest" | "legacy" | "mixed";
    private readonly latestCache: string;
    private readonly legacyCache: string;
    private readonly eraEvery: number;
    private currentEra: "latest" | "legacy";
    private zonesSinceEra = 0;
    private switchingEra = false;

    constructor(
        private readonly mapViewer: MapViewer,
        readonly options: AmbientOptions,
    ) {
        this.random = createRandom(options.seed);
        this.overlay = new AmbientOverlay(options.debug);
        this.eraMode = options.era ?? "mixed";
        this.latestCache = options.latestCache ?? mapViewer.loadedCache?.info.name ?? "osrs";
        this.legacyCache = options.legacyCache ?? "rs2-295_2005-02-21";
        this.eraEvery = Math.max(1, options.eraEvery ?? 4);
        const loadedLegacy = (mapViewer.loadedCache?.info.name ?? "").startsWith("rs2-");
        this.currentEra =
            options.era === "legacy" ? "legacy" : options.era === "latest" ? "latest" : loadedLegacy ? "legacy" : "latest";
    }

    // MARK: - Lifecycle

    start(): void {
        if (this.phase !== "idle") {
            return;
        }
        const renderer = this.mapViewer.renderer as any;
        renderer.fpsLimit = this.options.fps;
        this.mapViewer.renderDistance = this.options.renderDistance;
        this.mapViewer.tooltips = false;

        if (typeof renderer.setSkyColor === "function") {
            const sky = this.options.skyColor;
            renderer.setSkyColor((sky >> 16) & 0xff, (sky >> 8) & 0xff, sky & 0xff);
        }
        if (typeof renderer.fogDepth === "number") {
            renderer.fogDepth = this.options.fogDepth;
        }

        // Debug/automation handle (used by the dev harness and smoke tests).
        (window as any).__ambient = {
            state: () => this.debugState(),
            skip: () => this.beginTransition(),
        };

        const zone = this.pickInitialZone();
        this.enterZone(zone, true);
    }

    debugState() {
        const camera = this.mapViewer.camera;
        return {
            phase: this.phase,
            phaseTime: Number(this.phaseTime.toFixed(2)),
            zone: this.currentZone?.name,
            target: this.pendingZone?.name,
            motion: this.scene?.kind,
            era: this.currentEra,
            switchingEra: this.switchingEra,
            flightDuration: this.flight ? Number(this.flight.duration.toFixed(1)) : undefined,
            npc: this.scene?.npc?.name,
            camera: {
                x: Math.round(camera.getPosX()),
                z: Math.round(camera.getPosZ()),
                height: Math.round(-camera.getPosY()),
                yaw: camera.yaw & 2047,
                pitch: Math.round(camera.pitch),
                fov: camera.fov,
            },
            fps: Math.round(this.mapViewer.renderer.stats.frameTimeFps),
            maps: this.mapViewer.renderer.mapManager.mapSquares.size,
        };
    }

    stop(): void {
        this.overlay.destroy();
        this.phase = "idle";
    }

    /** Called once per rendered frame, before the camera is used. */
    update(deltaTimeMs: number): void {
        const deltaTime = Math.min(deltaTimeMs, 250) / 1000;
        this.lastDeltaTime = deltaTime;
        this.phaseTime += deltaTime;
        this.overlay.update(deltaTime);
        this.updateDebug(deltaTime);

        switch (this.phase) {
            case "dwell":
                this.updateDwell(deltaTime);
                break;
            case "flight":
                this.updateFlight();
                break;
            case "fade-out":
                this.updateFadeOut();
                break;
            case "black":
                this.updateBlack(deltaTime);
                break;
            default:
                break;
        }
    }

    // MARK: - Zones

    private availableZones(): Zone[] {
        const zones = zonesForEra(this.currentEra);
        return zones.length > 0 ? zones : ZONES;
    }

    private pickInitialZone(): Zone {
        const forced = this.options.forceZone
            ? ZONES.find((zone) => zone.name.toLowerCase() === this.options.forceZone!.toLowerCase())
            : undefined;
        return forced ?? pick(this.random, this.availableZones());
    }

    private chooseNextZone(): Zone {
        const allowed = this.availableZones();
        const next = pickNeighbour(
            this.random,
            this.currentZone,
            this.options.minFlightDistance,
            this.options.maxFlightDistance,
            new Set(this.recentZones),
            allowed,
        );

        if (next) {
            return next;
        }

        // Nothing comfortably nearby: allow a long cut anywhere in this era.
        const pool = allowed.filter(
            (zone) => zone.name !== this.currentZone?.name && !this.recentZones.includes(zone.name),
        );
        return pick(this.random, pool.length > 0 ? pool : allowed);
    }

    private rememberZone(zone: Zone): void {
        this.recentZones.push(zone.name);
        if (this.recentZones.length > RECENT_ZONE_MEMORY) {
            this.recentZones.shift();
        }
    }

    // MARK: - Phases

    private enterZone(zone: Zone, fadeIn: boolean): void {
        this.currentZone = zone;
        this.rememberZone(zone);
        this.pendingZone = zone;
        this.pendingLanding = zoneLandingPose(zone, this.random);
        this.teleport(this.pendingLanding);
        this.phase = "black";
        this.phaseTime = 0;
        this.blackTime = 0;
        this.fadeIn = fadeIn;
        this.overlay.setFade(1);
    }

    private planEra(): "latest" | "legacy" {
        if (this.eraMode === "latest" || !this.options.switchEra) {
            return "latest";
        }
        if (this.eraMode === "legacy") {
            return "legacy";
        }
        return this.zonesSinceEra >= this.eraEvery
            ? this.currentEra === "latest"
                ? "legacy"
                : "latest"
            : this.currentEra;
    }

    private eraLabel(): string {
        if (this.currentEra === "latest") {
            return "";
        }
        const year = /(\d{4})/.exec(this.legacyCache)?.[1];
        return ` · ${year ?? "legacy"}`;
    }

    /** Fades out, swaps the cache, then restarts in a new zone of the new era. */
    private beginEraSwitch(era: "latest" | "legacy"): void {
        this.pendingZone = undefined;
        this.pendingLanding = undefined;
        this.phase = "fade-out";
        this.phaseTime = 0;
        this.eraSwitchTarget = era;
    }

    private updateBlack(deltaTime: number): void {
        if (this.switchingEra) {
            return;
        }
        if (!this.pendingZone || !this.pendingLanding) {
            return;
        }

        this.blackTime += deltaTime;
        if (this.blackTime < 0.35) {
            return;
        }

        const status = this.mapStatusAt(this.pendingLanding);
        if (status === "invalid" || this.blackTime > 9) {
            // This zone cannot be rendered (missing/exported-out map square).
            this.enterZone(this.chooseNextZone(), true);
            return;
        }
        if (status !== "ready") {
            return;
        }

        this.beginDwell();
    }

    private beginDwell(): void {
        const zone = this.pendingZone!;
        const entry = this.pendingLanding!;

        const npc =
            this.random() < this.options.npcChance
                ? findNpcTarget(
                      this.loadedMapSquares(),
                      zone,
                      this.random,
                      Math.min(Math.max(zone.radius * 0.9, 24), 70),
                  )
                : undefined;

        this.scene = createScene(zone, this.random, this.options.dwellSeconds, entry, npc);
        this.npcLostTime = 0;
        this.phase = "dwell";
        this.phaseTime = 0;

        if (this.options.labels) {
            const fade = this.fadeIn ? this.options.fadeSeconds : 0.35;
            this.overlay.showLabel(zone.name + this.eraLabel(), 5, fade);
        }
    }

    private updateDwell(deltaTime: number): void {
        const scene = this.scene;
        if (!scene) {
            this.beginTransition();
            return;
        }

        const pose = scene.poseAt(this.phaseTime);
        this.applyPose(pose);

        if (this.fadeIn) {
            this.overlay.setFade(1 - smoothstep(0, this.options.fadeSeconds, this.phaseTime));
        }

        if (scene.kind === "npc") {
            const position = scene.npc?.position();
            this.npcLostTime = position ? 0 : this.npcLostTime + deltaTime;
            if (this.npcLostTime > 2.5) {
                this.beginTransition();
                return;
            }
        }

        if (this.phaseTime >= this.options.dwellSeconds) {
            this.beginTransition();
        }
    }

    private beginTransition(): void {
        const era = this.planEra();
        if (era !== this.currentEra) {
            this.beginEraSwitch(era);
            return;
        }

        this.zonesSinceEra++;
        const next = this.chooseNextZone();
        const from = this.lastPose ?? this.pendingLanding;
        if (!from) {
            this.enterZone(next, true);
            return;
        }

        const separation = this.currentZone
            ? distance(this.currentZone.x, this.currentZone.z, next.x, next.z)
            : Number.POSITIVE_INFINITY;

        if (
            separation >= this.options.minFlightDistance &&
            separation <= this.options.maxFlightDistance
        ) {
            this.beginFlight(next, from);
        } else {
            this.beginCut(next);
        }
    }

    private beginFlight(zone: Zone, from: Pose): void {
        const landing = zoneLandingPose(zone, this.random);
        this.flight = createFlight(from, landing, zone, this.random);
        this.currentZone = zone;
        this.rememberZone(zone);
        this.pendingZone = zone;
        this.pendingLanding = landing;
        this.phase = "flight";
        this.phaseTime = 0;
        this.fadeIn = false;
        this.overlay.setFade(0);
    }

    private updateFlight(): void {
        const flight = this.flight;
        if (!flight) {
            this.beginCut(this.chooseNextZone());
            return;
        }

        const progress = this.phaseTime / flight.duration;
        const pose = flightPoseAt(flight, progress);
        this.applyPose(pose);

        // Stream the terrain ahead of the camera so squares are already faded in
        // by the time they enter the frustum.
        this.prefetchAccumulator += 1;
        if (this.prefetchAccumulator >= 12) {
            this.prefetchAccumulator = 0;
            this.prefetchAhead(pose, 140);
        }

        if (progress >= 1) {
            this.flight = undefined;
            this.beginDwell();
        }
    }

    private beginCut(zone: Zone): void {
        this.pendingZone = zone;
        this.pendingLanding = zoneLandingPose(zone, this.random);
        this.currentZone = zone;
        this.rememberZone(zone);
        this.phase = "fade-out";
        this.phaseTime = 0;
        this.fadeIn = true;
    }

    private updateFadeOut(): void {
        this.overlay.setFade(smoothstep(0, this.options.fadeSeconds, this.phaseTime));
        if (this.phaseTime < this.options.fadeSeconds + 0.05) {
            return;
        }

        if (this.eraSwitchTarget) {
            const era = this.eraSwitchTarget;
            this.eraSwitchTarget = undefined;
            const cacheName = era === "legacy" ? this.legacyCache : this.latestCache;
            this.switchingEra = true;
            this.overlay.setFade(1);
            this.options
                .switchEra!(cacheName)
                .then((ok) => {
                    if (ok) {
                        this.currentEra = era;
                        this.zonesSinceEra = 0;
                    }
                })
                .catch((err) => console.warn("OSRS saver: era switch failed", err))
                .finally(() => {
                    this.switchingEra = false;
                    this.enterZone(this.chooseNextZone(), true);
                });
            this.phase = "black";
            this.phaseTime = 0;
            this.blackTime = 0;
            return;
        }

        if (this.pendingLanding) {
            this.teleport(this.pendingLanding);
        }
        this.phase = "black";
        this.phaseTime = 0;
        this.blackTime = 0;
    }

    // MARK: - Helpers

    private teleport(pose: Pose): void {
        this.smoother.reset(pose);
        this.applyPose(pose, true);
    }

    /**
     * All camera movement goes through here: the target pose is low-passed so map
     * hitches, NPC tile steps and phase changes never show up as jitter.
     */
    private applyPose(pose: Pose, snap = false): void {
        const smoothed = snap ? pose : this.smoother.update(pose, this.lastDeltaTime);
        applyPose(this.mapViewer.camera, smoothed);
        this.lastPose = smoothed;
    }

    private prefetchAhead(pose: Pose, lookAheadTiles: number): void {
        const forward = forwardFromYaw(pose.yaw);
        const aheadX = pose.x + forward.dx * lookAheadTiles;
        const aheadZ = pose.z + forward.dz * lookAheadTiles;
        const mapManager = this.mapViewer.renderer.mapManager;
        const mapX = Math.floor(aheadX / 64);
        const mapY = Math.floor(aheadZ / 64);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                mapManager.loadMap(mapX + dx, mapY + dz);
            }
        }
    }

    private loadedMapSquares(): MapSquareLike[] {
        const squares: MapSquareLike[] = [];
        for (const square of this.mapViewer.renderer.mapManager.mapSquares.values()) {
            squares.push(square as unknown as MapSquareLike);
        }
        return squares;
    }

    private mapStatusAt(pose: Pose): "ready" | "loading" | "invalid" {
        const mapX = Math.floor(pose.x / 64);
        const mapY = Math.floor(pose.z / 64);
        const mapManager = this.mapViewer.renderer.mapManager;
        const id = (mapX << 8) | mapY;
        if (mapManager.invalidMapIds.has(id)) {
            return "invalid";
        }
        return mapManager.getMap(mapX, mapY) ? "ready" : "loading";
    }

    private updateDebug(deltaTime: number): void {
        if (!this.options.debug) {
            return;
        }
        this.debugAccumulator += deltaTime;
        if (this.debugAccumulator < 0.25) {
            return;
        }
        this.debugAccumulator = 0;

        const camera = this.mapViewer.camera;
        const stats = this.mapViewer.renderer.stats;
        const mapCount = this.mapViewer.renderer.mapManager.mapSquares.size;
        const target =
            this.phase === "flight"
                ? this.pendingZone?.name
                : this.currentZone?.name;
        this.overlay.setDebug(
            [
                `zone   ${target ?? "-"} (${this.currentZone?.name ?? "-"})`,
                `phase  ${this.phase} ${this.phaseTime.toFixed(1)}s${
                    this.flight ? `/${this.flight.duration.toFixed(1)}s` : ""
                }`,
                `motion ${this.scene?.kind ?? (this.flight ? "flight" : "-")}`,
                `camera ${camera.getPosX().toFixed(0)},${camera.getPosZ().toFixed(0)} h${(
                    -camera.getPosY()
                ).toFixed(0)} yaw${camera.yaw & 2047} pitch${camera.pitch.toFixed(0)}`,
                `render ${stats.frameTimeFps.toFixed(0)}fps maps ${mapCount} visible ${
                    this.mapViewer.renderer.mapManager.visibleMapCount
                }`,
            ].join("\n"),
        );
    }
}
