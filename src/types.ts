import Monoscope from ".";

export type MonoscopeConfig = {
  apiKey?: string;
  serviceName?: string;
  exporterEndpoint?: string;
  /** OTLP /v1/metrics endpoint for web-vital histograms. Defaults to the trace endpoint with /v1/traces → /v1/metrics. */
  metricsExporterEndpoint?: string;
  propagateTraceHeaderCorsUrls?: RegExp[];
  /** @deprecated Use `apiKey` instead. */
  projectId?: string;
  resourceAttributes?: Record<string, string>;
  instrumentations?: unknown[];
  replayEventsBaseUrl?: string;
  enableNetworkEvents?: boolean;
  user?: MonoscopeUser;
  debug?: boolean;
  sampleRate?: number; // 0-1, applies to traces
  replaySampleRate?: number; // 0-1, applies to replay
  enabled?: boolean; // default true
  resourceTimingThresholdMs?: number; // min duration to report (default 200)
  captureResourceTiming?: boolean; // emit a span per resource > threshold (default false — high volume, opt-in)
  captureLongTasks?: boolean; // emit a span per long task > 50ms (default true)
  enableUserInteraction?: boolean; // trace user clicks/submits (default true) — groups fetch/xhr under the originating interaction trace
};

export type MonoscopeUser = {
  email?: string;
  full_name?: string;
  name?: string;
  id?: string;
  roles?: string[];
} & Record<string, string | string[] | undefined>;

declare global {
  interface Window {
    monoscope: Monoscope;
  }
}
