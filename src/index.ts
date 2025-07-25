import { MonoscopeReplay } from "./replay";
import { configureOpenTelemetry } from "./tracing";
import { MonoscopeConfig } from "./types";
import { v4 as uuidv4 } from "uuid";

class Monoscope {
  replay: MonoscopeReplay;
  config: MonoscopeConfig;
  sessionId: string;

  constructor(config: MonoscopeConfig) {
    if (!config.projectId) {
      throw new Error("MonoscopeConfig must include projectId");
    }

    if (!config.replayEndpoint) {
      config.replayEndpoint = `https://app.apitoolkit.io/p/${config.projectId}/replay`;
    }
    if (!config.exporterEndpoint) {
      config.exporterEndpoint = "http://otelcol.apitoolkit.io:4318";
    }

    const storedSessionId = sessionStorage.getItem("monoscope-session-id");
    if (storedSessionId) {
      this.sessionId = storedSessionId;
    } else {
      this.sessionId = uuidv4();
      sessionStorage.setItem("monoscope-session-id", this.sessionId);
    }

    configureOpenTelemetry(config, this.sessionId);
    this.config = config;
    this.replay = new MonoscopeReplay(config, this.sessionId);
    this.replay.configure();
  }
}

export default Monoscope;
