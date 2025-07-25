export type MonoscopeConfig = {
  serviceName: string;
  exporterEndpoint: string;
  propagateTraceHeaderCorsUrls?: RegExp[];
  projectId: string;
  resourceAttributes?: Record<string, string>;
  documentLoadAttributes?: (span: any) => void;
  xhrAttributes?: (span: any, xhr: any) => void;
  fetchAttributes?: (span: any, request: any) => void;
  instrumentations?: any[];
  replayEndpoint: string;
};
