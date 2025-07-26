import { MonoscopeConfig } from "./types";
import * as rrweb from "rrweb";

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
  }

  configure() {
    rrweb.record({
      emit: (event) => {
        this.events.push(event);
      },
    });
    setInterval(this.save, 15 * 1000);
  }

  save() {
    if (this.events.length === 0) return;
    let { replayEventsBaseUrl, projectId } = this.config;
    if (!replayEventsBaseUrl) {
      replayEventsBaseUrl = `https://app.apitoolkit.io/p/${projectId}/rrweb`;
    } else {
      replayEventsBaseUrl = `${replayEventsBaseUrl}/p/${projectId}/rrweb`;
    }
    const events = this.events;
    this.events = [];
    const body = JSON.stringify({ events, sessionId: this.sessionId });
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
