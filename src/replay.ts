import { getRecordConsolePlugin } from "@rrweb/rrweb-plugin-console-record";
import { MonoscopeConfig } from "./types";
import * as rrweb from "rrweb";

const MAX_EVENT_BATCH = 50;
const SAVE_INTERVAL = 10000;
const MAX_RETRY_EVENTS = 1000;

export class MonoscopeReplay {
  private events: any[] = [];
  private config: MonoscopeConfig;
  private sessionId: string;
  private stopRecording: (() => void) | undefined = undefined;
  private saveInterval: NodeJS.Timeout | null = null;
  private isSaving: boolean = false;
  private isConfigured: boolean = false;

  constructor(config: MonoscopeConfig, sessionId: string) {
    this.sessionId = sessionId;
    this.config = config;
    this.events = [];

    // Bind methods
    this.save = this.save.bind(this);
    this.configure = this.configure.bind(this);
    this.handleUnload = this.handleUnload.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);

    // Setup event listeners
    this.setupEventListeners();
  }

  private setupEventListeners() {
    window.addEventListener("beforeunload", this.handleUnload);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("pagehide", this.handleUnload);
  }

  private handleUnload() {
    this.save(true); // Force synchronous save on unload
  }

  private handleVisibilityChange() {
    if (document.visibilityState === "hidden") {
      this.save();
    }
  }

  configure() {
    if (this.isConfigured) {
      console.warn("MonoscopeReplay already configured");
      return;
    }

    try {
      this.stopRecording = rrweb.record({
        emit: (event) => {
          this.events.push(event);
          // Auto-save when batch size reached
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

        // Performance settings
        checkoutEveryNms: 15 * 1000, // Full snapshot every 15s
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
          scroll: 150, // Throttle scroll events
          media: 800,
          input: "last", // Only capture final input value
        },

        plugins: [
          getRecordConsolePlugin({
            level: ["info", "log", "warn", "error"],
            lengthThreshold: 10000,
            stringifyOptions: {
              stringLengthLimit: 1000,
              numOfKeysLimit: 100,
              depthOfLimit: 2, // Increased from 1 for better context
            },
          }),
        ],
      });

      this.saveInterval = setInterval(() => {
        this.save();
      }, SAVE_INTERVAL);

      this.isConfigured = true;
      console.log("MonoscopeReplay configured successfully");
    } catch (error) {
      console.error("Failed to configure MonoscopeReplay:", error);
      throw error;
    }
  }

  async save(forceSynchronous: boolean = false) {
    if (this.isSaving && !forceSynchronous) {
      return;
    }
    if (this.events.length === 0) {
      return;
    }
    if (this.events.length > MAX_RETRY_EVENTS) {
      console.warn(
        `Event queue exceeded ${MAX_RETRY_EVENTS}, dropping oldest events`
      );
      this.events = this.events.slice(-MAX_RETRY_EVENTS);
    }

    this.isSaving = true;

    const { replayEventsBaseUrl, projectId } = this.config;

    // Construct base URL
    let baseUrl = replayEventsBaseUrl || "https://app.monoscope.tech";
    baseUrl = `${baseUrl}/rrweb/${projectId}`;

    // Get events to send and clear buffer
    const eventsToSend = [...this.events];
    this.events = [];

    const payload = {
      events: eventsToSend,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      eventCount: eventsToSend.length,
    };

    try {
      if (forceSynchronous && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(payload)], {
          type: "application/json",
        });
        const sent = navigator.sendBeacon(baseUrl, blob);

        if (!sent) {
          console.warn("sendBeacon failed, events may be lost");
        }
      } else {
        // Regular fetch with keepalive
        const response = await fetch(baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          keepalive: true,
        });

        if (!response.ok) {
          throw new Error(
            `Failed to save replay events: ${response.status} ${response.statusText}`
          );
        }
        console.log(`Successfully saved ${eventsToSend.length} replay events`);
      }
    } catch (error) {
      console.error("Failed to save replay events:", error);
      this.events = [...eventsToSend, ...this.events];
      if (this.events.length > MAX_RETRY_EVENTS) {
        this.events = this.events.slice(-MAX_RETRY_EVENTS);
      }
    } finally {
      this.isSaving = false;
    }
  }
  stop() {
    this.save(true);
    if (this.stopRecording) {
      this.stopRecording();
      this.stopRecording = undefined;
    }

    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    window.removeEventListener("beforeunload", this.handleUnload);
    window.removeEventListener("pagehide", this.handleUnload);
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange
    );

    this.isConfigured = false;
    console.log("MonoscopeReplay stopped");
  }

  getEventCount(): number {
    return this.events.length;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  isRecording(): boolean {
    return this.isConfigured && this.stopRecording !== null;
  }
}
