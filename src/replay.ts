import { getRecordConsolePlugin } from "@rrweb/rrweb-plugin-console-record";
import { MonoscopeConfig } from "./types";
import * as rrweb from "rrweb";

const MAX_EVENT_BATCH = 5;
export class MonoscopeReplay {
  events: any[] = [];
  config: MonoscopeConfig;
  sessionId: string;
  constructor(config: MonoscopeConfig, sessionId: string) {
    this.sessionId = sessionId;
    this.config = config;
    this.save = this.save.bind(this);
    this.events = [];
    this.configure = this.configure.bind(this);

    window.addEventListener("unload", () => this.save());
  }

  configure() {
    rrweb.record({
      emit: (event) => {
        this.events.push(event);
        if (this.events.length >= MAX_EVENT_BATCH) {
          this.save();
        }
      },
      checkoutEveryNms: 10 * 1000,
      checkoutEveryNth: 10,
      sampling: {
        mouseInteraction: false,
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
            depthOfLimit: 1,
          },
        }),
      ],
    });
    setInterval(this.save, 5 * 1000);
  }

  save() {
    if (this.events.length === 0) return;
    let { replayEventsBaseUrl, projectId } = this.config;
    if (!replayEventsBaseUrl) {
      replayEventsBaseUrl = `https://app.apitoolkit.io/rrweb/${projectId}`;
    } else {
      replayEventsBaseUrl = `${replayEventsBaseUrl}/rrweb/${projectId}`;
    }
    const events = this.events;
    this.events = [];
    const body = JSON.stringify({
      events,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
    });
    fetch(replayEventsBaseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    }).catch((error) => {
      console.error("Failed to save replay events:", error);
      this.events = [...events, ...this.events];
    });
  }
}
