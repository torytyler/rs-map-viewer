/**
 * Plain-DOM overlay: cross-fade to black between scenes, the zone name label and
 * an optional debug readout. Kept out of React so the per-frame camera work never
 * triggers a re-render.
 */
export class AmbientOverlay {
    private readonly root: HTMLDivElement;
    private readonly fade: HTMLDivElement;
    private readonly label: HTMLDivElement;
    private readonly debug: HTMLDivElement;

    private labelRemaining = 0;
    private labelDuration = 0;

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
            transition: "opacity 700ms ease",
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

    setFade(opacity: number): void {
        this.fade.style.opacity = String(Math.max(0, Math.min(1, opacity)));
    }

    showLabel(text: string, seconds: number): void {
        this.label.textContent = text;
        this.label.style.opacity = "1";
        this.labelDuration = seconds;
        this.labelRemaining = seconds;
    }

    hideLabel(): void {
        this.label.style.opacity = "0";
        this.labelRemaining = 0;
    }

    setDebug(text: string): void {
        if (!this.showDebug) {
            return;
        }
        this.debug.textContent = text;
    }

    update(deltaTime: number): void {
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
