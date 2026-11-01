/**
 * Plain-DOM overlay: cross-fade to black between scenes, the zone name label and
 * an optional debug readout. Kept out of React so the per-frame camera work never
 * triggers a re-render.
 */
export class AmbientOverlay {
    private currentFade = 1;
    private readonly root: HTMLDivElement;
    private readonly fade: HTMLDivElement;
    private readonly label: HTMLDivElement;
    private readonly debug: HTMLDivElement;

    private labelRemaining = 0;
    private labelDelay = 0;

    constructor(private readonly showDebug: boolean) {
        this.root = document.createElement("div");
        Object.assign(this.root.style, {
            position: "fixed",
            inset: "0",
            pointerEvents: "none",
            zIndex: "20",
            overflow: "hidden",
        } as CSSStyleDeclaration);

        this.fade = document.createElement("div");
        Object.assign(this.fade.style, {
            position: "absolute",
            inset: "0",
            backgroundColor: "#000",
            opacity: "1",
        } as CSSStyleDeclaration);

        this.label = document.createElement("div");
        Object.assign(this.label.style, {
            position: "absolute",
            left: "0",
            right: "0",
            bottom: "6vh",
            textAlign: "center",
            fontFamily: '"OSRS Bold", "Trebuchet MS", serif',
            fontSize: "clamp(18px, 2.2vw, 34px)",
            letterSpacing: "0.04em",
            color: "#ffd93b",
            textShadow: "0 2px 0 #3d2b00, 0 0 18px rgba(0,0,0,0.9)",
            opacity: "0",
            transform: "translateY(8px)",
            transition: "opacity 900ms ease, transform 1200ms cubic-bezier(0.22, 1, 0.36, 1)",
        } as CSSStyleDeclaration);

        this.debug = document.createElement("div");
        Object.assign(this.debug.style, {
            position: "absolute",
            left: "10px",
            top: "10px",
            fontFamily: "ui-monospace, Menlo, monospace",
            fontSize: "12px",
            lineHeight: "1.4",
            color: "#8ef",
            textShadow: "0 1px 2px #000",
            whiteSpace: "pre",
            opacity: showDebug ? "0.9" : "0",
        } as CSSStyleDeclaration);

        this.root.appendChild(this.fade);
        this.root.appendChild(this.label);
        this.root.appendChild(this.debug);
        document.body.appendChild(this.root);
    }

    /** Current fade-to-black opacity (0 = clear). */
    get fadeOpacity(): number {
        return this.currentFade;
    }

    setFade(opacity: number): void {
        this.currentFade = Math.max(0, Math.min(1, opacity));
        this.fade.style.opacity = String(this.currentFade);
    }

    /** `delay` lets the caption wait for the fade-in to finish. */
    showLabel(text: string, seconds: number, delay = 0): void {
        this.label.textContent = text;
        this.label.style.opacity = "0";
        this.label.style.transform = "translateY(8px)";
        this.labelRemaining = seconds;
        this.labelDelay = delay;
    }

    hideLabel(): void {
        this.label.style.opacity = "0";
        this.label.style.transform = "translateY(8px)";
        this.labelRemaining = 0;
        this.labelDelay = 0;
    }

    setDebug(text: string): void {
        if (!this.showDebug) {
            return;
        }
        this.debug.textContent = text;
    }

    update(deltaTime: number): void {
        if (this.labelDelay > 0) {
            this.labelDelay -= deltaTime;
            if (this.labelDelay > 0) {
                return;
            }
            this.label.style.opacity = "1";
            this.label.style.transform = "translateY(0)";
        }

        if (this.labelRemaining > 0) {
            this.labelRemaining -= deltaTime;
            const fadeWindow = 1.1;
            if (this.labelRemaining < fadeWindow) {
                this.label.style.opacity = String(Math.max(0, this.labelRemaining / fadeWindow));
            }
        }
    }

    destroy(): void {
        this.root.remove();
    }
}
