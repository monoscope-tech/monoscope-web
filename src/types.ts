import Monoscope from ".";

export type MonoscopeConfig = {
  serviceName: string;
  exporterEndpoint?: string;
  propagateTraceHeaderCorsUrls?: RegExp[];
  projectId: string;
  resourceAttributes?: Record<string, string>;
  instrumentations?: any[];
  replayEventsBaseUrl?: string;
  user?: MonoscopeUser;
};

export type MonoscopeUser = {
  email?: string;
  full_name?: string;
  name?: string;
  id?: string;
  roles?: string[];
} & Record<string, string>;
declare global {
  interface Window {
    monoscope: Monoscope;
  }
}
