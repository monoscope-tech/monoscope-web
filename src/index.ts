import { MonoscopeReplay } from "./replay";
import { OpenTelemetryManager } from "./tracing";
import { MonoscopeConfig, MonoscopeUser } from "./types";
import { v4 as uuidv4 } from "uuid";

class Monoscope {
  replay: MonoscopeReplay;
  config: MonoscopeConfig;
  otel: OpenTelemetryManager;
  sessionId: string;

  constructor(config: MonoscopeConfig) {
    if (!config.projectId) {
      throw new Error("MonoscopeConfig must include projectId");
    }

    const storedSessionId = sessionStorage.getItem("monoscope-session-id");
    if (storedSessionId) {
      this.sessionId = storedSessionId;
    } else {
      this.sessionId = uuidv4();
      sessionStorage.setItem("monoscope-session-id", this.sessionId);
    }

    this.config = config;
    this.replay = new MonoscopeReplay(config, this.sessionId);
    this.otel = new OpenTelemetryManager(config, this.sessionId);
    this.otel.configure();
    this.replay.configure();
     
  }

  getSessionId() {
    return this.sessionId;
  }
  setUser(u: MonoscopeUser) {
    this.otel.setUser(u);
  }
}

 

export default Monoscope;
