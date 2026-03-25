import Monoscope from ".";

export type MonoscopeConfig = {
  serviceName: string;
  exporterEndpoint?: string;
  propagateTraceHeaderCorsUrls?: RegExp[];
  projectId: string;
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
