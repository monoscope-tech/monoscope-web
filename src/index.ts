import { MonoscopeReplay } from "./replay";
import { OpenTelemetryManager } from "./tracing";
import { MonoscopeConfig, MonoscopeUser } from "./types";
import { v4 as uuidv4 } from "uuid";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const LAST_ACTIVITY_KEY = "monoscope-last-activity";

class Monoscope {
  replay: MonoscopeReplay;
  config: MonoscopeConfig;
  otel: OpenTelemetryManager;
  sessionId: string;
  tabId: string;
  private lastActivityTime: number;

  constructor(config: MonoscopeConfig) {
    if (!config.projectId) {
      throw new Error("MonoscopeConfig must include projectId");
    }

    this.sessionId = this.resolveSessionId();
    this.lastActivityTime = Date.now();
    this.persistActivity();

    this.tabId = uuidv4();

    this.config = config;
    this.replay = new MonoscopeReplay(config, this.sessionId, this.tabId);
    this.otel = new OpenTelemetryManager(config, this.sessionId, this.tabId);
    this.otel.configure();
    this.replay.configure();

    this.setupActivityTracking();
  }

  private resolveSessionId(): string {
    const storedId = sessionStorage.getItem("monoscope-session-id");
    const lastActivity = sessionStorage.getItem(LAST_ACTIVITY_KEY);

    if (storedId && lastActivity) {
      const elapsed = Date.now() - parseInt(lastActivity, 10);
      if (elapsed < SESSION_TIMEOUT_MS) {
        return storedId;
      }
    }

    const newId = uuidv4();
    sessionStorage.setItem("monoscope-session-id", newId);
    return newId;
  }

  private persistActivity() {
    sessionStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
  }

  private rotateSession() {
    // Flush pending replay events under the old session ID
    this.replay.save();

    this.sessionId = uuidv4();
    sessionStorage.setItem("monoscope-session-id", this.sessionId);
    this.replay.updateSessionId(this.sessionId);
    this.otel.updateSessionId(this.sessionId);
    if (this.config.debug) {
      console.log("Monoscope: session rotated due to inactivity");
    }
  }

  private checkAndRefreshSession() {
    const now = Date.now();
    if (now - this.lastActivityTime >= SESSION_TIMEOUT_MS) {
      this.rotateSession();
    }
    this.lastActivityTime = now;
    this.persistActivity();
  }

  private setupActivityTracking() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.checkAndRefreshSession();
      }
    });

    let lastTracked = Date.now();
    const trackActivity = () => {
      const now = Date.now();
      if (now - lastTracked > 5000) {
        lastTracked = now;
        this.lastActivityTime = now;
        this.persistActivity();
      }
    };

    document.addEventListener("click", trackActivity, { capture: true, passive: true });
    document.addEventListener("keydown", trackActivity, { capture: true, passive: true });
  }

  getSessionId() {
    return this.sessionId;
  }
  getTabId() {
    return this.tabId;
  }
  setUser(u: MonoscopeUser) {
    this.otel.setUser(u);
  }
}

 

export default Monoscope;
