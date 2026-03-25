import { getRecordConsolePlugin } from "@rrweb/rrweb-plugin-console-record";
import { MonoscopeConfig } from "./types";
import * as rrweb from "rrweb";

const MAX_EVENT_BATCH = 50;
const SAVE_INTERVAL = 2000;
const MAX_RETRY_EVENTS = 5000;

export class MonoscopeReplay {
  private events: any[] = [];
  private config: MonoscopeConfig;
  private sessionId: string;
  private tabId: string;
  private stopRecording: (() => void) | undefined = undefined;
  private saveInterval: ReturnType<typeof setInterval> | null = null;
  private isSaving: boolean = false;
  private isConfigured: boolean = false;
  private _enabled: boolean = true;
  private userAttributes: Record<string, string | string[] | undefined> = {};

  private _listenersAttached = false;
  private handleUnload = () => this.save(true);
  private handleVisibilityChange = () => { if (document.visibilityState === "hidden") this.save(); };

  constructor(config: MonoscopeConfig, sessionId: string, tabId: string) {
    this.sessionId = sessionId;
    this.tabId = tabId;
    this.config = config;
    this.setupListeners();
  }

  private setupListeners() {
    if (typeof window === "undefined" || this._listenersAttached) return;
    this._listenersAttached = true;
    window.addEventListener("beforeunload", this.handleUnload);
    window.addEventListener("pagehide", this.handleUnload);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private removeListeners() {
    if (typeof window === "undefined" || !this._listenersAttached) return;
    this._listenersAttached = false;
    window.removeEventListener("beforeunload", this.handleUnload);
    window.removeEventListener("pagehide", this.handleUnload);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private trimEvents() {
    if (this.events.length <= MAX_RETRY_EVENTS) return;
    if (this.config.debug) {
      console.warn(
        `Event queue exceeded ${MAX_RETRY_EVENTS}, dropping middle events (preserving snapshots)`,
      );
    }
    // rrweb EventType.FullSnapshot (type 2) — required for replay playback
    const fullSnapshots = this.events.filter((e) => e.type === 2);
    const otherEvents = this.events.filter((e) => e.type !== 2);
    const remainingSlots = Math.max(0, MAX_RETRY_EVENTS - fullSnapshots.length);
    this.events = [...fullSnapshots, ...otherEvents.slice(-remainingSlots)];
    this.events.sort((a, b) => a.timestamp - b.timestamp);
  }

  configure() {
    if (typeof window === "undefined") return;
    if (this.isConfigured) return;
    this.setupListeners();

    const rate = Math.max(0, Math.min(1, this.config.replaySampleRate ?? 1));
    if (Math.random() >= rate) {
      this._enabled = false;
      if (this.config.debug) console.log("MonoscopeReplay: sampled out");
      return;
    }

    try {
      this.stopRecording = rrweb.record({
        emit: (event) => {
          if (!this._enabled) return;
          this.events.push(event);
          if (this.events.length >= MAX_EVENT_BATCH) {
            this.save();
          }
        },

        blockClass: "rr-block",

        maskAllInputs: true,
        maskInputOptions: {
          password: true,
          email: true,
          tel: true,
        },
        maskTextClass: "rr-mask",

        checkoutEveryNms: 15 * 1000,
        sampling: {
          mouseInteraction: {
            MouseUp: false,
            MouseDown: false,
            Click: true,
            ContextMenu: false,
            DblClick: true,
            Focus: false,
            Blur: false,
            TouchStart: true,
            TouchEnd: false,
          },
          mousemove: true,
          scroll: 150,
          media: 800,
          input: "last",
        },

        plugins: [
          getRecordConsolePlugin({
            level: ["info", "log", "warn", "error"],
            lengthThreshold: 10000,
            stringifyOptions: {
              stringLengthLimit: 1000,
              numOfKeysLimit: 100,
              depthOfLimit: 2,
            },
          }),
        ],
      });

      this.saveInterval = setInterval(() => this.save(), SAVE_INTERVAL);

      this.isConfigured = true;
      if (this.config.debug) {
        console.log("MonoscopeReplay configured successfully");
      }
    } catch (error) {
      console.warn("Monoscope: failed to configure replay", error);
    }
  }

  async save(forceSynchronous: boolean = false) {
    if (this.isSaving && !forceSynchronous) return;
    if (this.events.length === 0) return;

    this.trimEvents();
    this.isSaving = true;

    const baseUrl = `${this.config.replayEventsBaseUrl || "https://app.monoscope.tech"}/rrweb/${this.config.projectId}`;

    const eventsToSend = [...this.events];
    this.events = [];

    const payload = {
      events: eventsToSend,
      sessionId: this.sessionId,
      tabId: this.tabId,
      timestamp: new Date().toISOString(),
      eventCount: eventsToSend.length,
      user: Object.keys(this.userAttributes).length > 0 ? this.userAttributes : undefined,
    };

    try {
      if (forceSynchronous && typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(payload)], {
          type: "application/json",
        });
        const sent = navigator.sendBeacon(baseUrl, blob);
        if (!sent) {
          fetch(baseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            keepalive: true,
          }).catch(() => {});
        }
      } else {
        const body = JSON.stringify(payload);
        const response = await fetch(baseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: body.length < 63000,
        });

        if (!response.ok) {
          throw new Error(
            `Failed to save replay events: ${response.status} ${response.statusText}`,
          );
        }
        if (this.config.debug) {
          console.log(
            `Successfully saved ${eventsToSend.length} replay events`,
          );
        }
      }
    } catch (error) {
      console.warn("Monoscope: failed to save replay events:", error);
      this.events = [...eventsToSend, ...this.events];
      this.trimEvents();
    } finally {
      this.isSaving = false;
    }
  }

  stop() {
    this.save(true).catch(() => {});
    if (this.stopRecording) {
      this.stopRecording();
      this.stopRecording = undefined;
    }

    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    this.removeListeners();
    this.isConfigured = false;
    if (this.config.debug) {
      console.log("MonoscopeReplay stopped");
    }
  }

  setEnabled(enabled: boolean) {
    this._enabled = enabled;
    if (!enabled) this.stop();
  }

  setUser(user: Record<string, string | string[] | undefined>) {
    this.userAttributes = { ...this.userAttributes, ...user };
  }

  getEventCount(): number {
    return this.events.length;
  }

  updateSessionId(sessionId: string) {
    this.sessionId = sessionId;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  isRecording(): boolean {
    return this.isConfigured && this.stopRecording !== undefined;
  }
}
