import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  MonoscopeProvider,
  useMonoscope,
  useMonoscopeUser,
  MonoscopeErrorBoundary,
} from "../../src/react";

const config = {
  apiKey: "demo-project",
  debug: true,
};

function DebugLog({ entries }: { entries: string[] }) {
  return (
    <pre style={{ background: "#111", color: "#0f0", padding: "1rem", fontFamily: "monospace", fontSize: 13, height: 300, overflowY: "auto", borderRadius: 4 }}>
      {entries.join("\n")}
    </pre>
  );
}

function BuggyComponent() {
  throw new Error("Test error from BuggyComponent");
}

function Controls() {
  const monoscope = useMonoscope();
  const [log, setLog] = useState<string[]>([]);
  const [showBuggy, setShowBuggy] = useState(false);
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);

  useMonoscopeUser(user);

  const append = (msg: string) => setLog((prev) => [...prev, new Date().toISOString().slice(11, 23) + " " + msg]);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 600, margin: "2rem auto" }}>
      <h1>Monoscope React Example</h1>
      <p>Session: <code>{monoscope?.getSessionId()}</code></p>
      <div>
        <button onClick={() => { monoscope?.recordEvent("button_click", { "button.name": "demo" }); append("Recorded event: button_click"); }}>
          Record Event
        </button>{" "}
        <button onClick={() => { setUser({ id: "user-42", email: "demo@example.com" }); append("Set user: user-42"); }}>
          Set User
        </button>{" "}
        <button onClick={() => { monoscope?.startSpan("custom-op", (span) => { span.setAttribute("example", true); append("Custom span executed"); }); }}>
          Custom Span
        </button>{" "}
        <button onClick={() => { setShowBuggy(true); append("Rendering buggy component..."); }}>
          Trigger Error Boundary
        </button>
      </div>

      {showBuggy && (
        <MonoscopeErrorBoundary fallback={<div style={{ color: "red", marginTop: "1rem" }}>Error caught by MonoscopeErrorBoundary and reported to Monoscope.</div>}>
          <BuggyComponent />
        </MonoscopeErrorBoundary>
      )}

      <h3>Debug Log</h3>
      <DebugLog entries={log} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MonoscopeProvider config={config}>
      <Controls />
    </MonoscopeProvider>
  </StrictMode>
);
