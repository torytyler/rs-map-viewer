import { pixelRatio } from "../../util/DeviceUtil";
import { RenderStats } from "./RenderStats";

function resizeCanvas(canvas: HTMLCanvasElement) {
    const devicePixelRatio = pixelRatio;
    const width = canvas.offsetWidth * devicePixelRatio;
    const height = canvas.offsetHeight * devicePixelRatio;

    if (width !== canvas.width || height !== canvas.height) {
        canvas.width = width;
        canvas.height = height;
        return true;
    }

    return false;
}

/**
 * Drives the render loop.
 *
 * Normally that is `requestAnimationFrame`, but WebKit stops delivering rAF to
 * pages it believes are hidden - which includes the legacy screen saver
 * extension's window. Timers keep running there, so we watch for a starved rAF
 * and fall back to a timer loop (capped by `fpsLimit`).
 */
export abstract class Renderer {
    canvas: HTMLCanvasElement;
    animationId: number | undefined;
    timeoutId: number | undefined;
    watchdogId: number | undefined;
    running: boolean = false;

    fpsLimit: number = 999;

    stats: RenderStats = new RenderStats();

    private loopMode: "raf" | "timer" = "raf";
    private lastFrameCallback = 0;
    private lastFrameCount = 0;

    constructor() {
        this.canvas = document.createElement("canvas");
        this.canvas.style.width = "100%";
        this.canvas.style.height = "100%";
        this.canvas.tabIndex = 0;
    }

    abstract init(): Promise<void>;

    abstract cleanUp(): void;

    start() {
        if (this.running) {
            return;
        }
        this.running = true;
        this.lastFrameCallback = performance.now();
        this.schedule();

        this.watchdogId = window.setInterval(() => {
            if (!this.running || this.loopMode !== "raf") {
                return;
            }
            const starved = performance.now() - this.lastFrameCallback > 1000;
            if (starved) {
                console.warn("Renderer: requestAnimationFrame starved, using timer loop");
                this.setLoopMode("timer");
            }
        }, 1000);
    }

    stop() {
        this.running = false;
        if (this.animationId !== undefined) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }
        if (this.timeoutId !== undefined) {
            window.clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }
        if (this.watchdogId !== undefined) {
            window.clearInterval(this.watchdogId);
            this.watchdogId = undefined;
        }
        this.cleanUp();
    }

    /** Switches between vsync-driven and timer-driven updates. */
    setLoopMode(mode: "raf" | "timer"): void {
        if (this.loopMode === mode) {
            return;
        }
        this.loopMode = mode;
        if (this.animationId !== undefined) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }
        if (this.timeoutId !== undefined) {
            window.clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }
        this.schedule();
    }

    getLoopMode(): "raf" | "timer" {
        return this.loopMode;
    }

    private schedule(): void {
        if (!this.running) {
            return;
        }
        if (this.loopMode === "raf") {
            this.animationId = requestAnimationFrame(this.frameCallback);
        } else {
            const target = this.fpsLimit > 0 && this.fpsLimit < 999 ? this.fpsLimit : 60;
            this.timeoutId = window.setTimeout(() => {
                this.frameCallback(performance.now());
            }, Math.max(1000 / target, 4));
        }
    }

    onResize(width: number, height: number) {}

    frameCallback = (time: DOMHighResTimeStamp) => {
        this.lastFrameCallback = performance.now();
        try {
            const resized = resizeCanvas(this.canvas);
            if (resized) {
                this.onResize(this.canvas.width, this.canvas.height);
            }

            const deltaTime = this.stats.getDeltaTime(time);

            // The timer loop is already rate limited; only rAF needs the cap.
            if (this.loopMode === "raf" && this.fpsLimit && deltaTime > 0) {
                const tolerance = 1;
                if (deltaTime < 1000 / this.fpsLimit - tolerance) {
                    return;
                }
            }

            this.stats.update(time);

            this.render(time, deltaTime, resized);

            this.onFrameEnd();
        } finally {
            if (this.running) {
                this.schedule();
            }
        }
    };

    abstract render(
        time: DOMHighResTimeStamp,
        deltaTime: DOMHighResTimeStamp,
        resized: boolean,
    ): void;

    onFrameEnd() {
        this.stats.onFrameEnd();
        this.lastFrameCount = this.stats.frameCount;
    }
}
