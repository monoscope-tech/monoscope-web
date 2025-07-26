export type MonoscopeConfig = {
  serviceName: string;
  exporterEndpoint?: string;
  propagateTraceHeaderCorsUrls?: RegExp[];
  projectId: string;
  resourceAttributes?: Record<string, string>;
  instrumentations?: any[];
  replayEventsBaseUrl?: string;
};
