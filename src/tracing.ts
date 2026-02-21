import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { MonoscopeConfig, MonoscopeUser } from "./types";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

export class OpenTelemetryManager {
  private config: MonoscopeConfig;
  private sessionId: string;
  private tabId: string;
  private provider: WebTracerProvider;

  constructor(config: MonoscopeConfig, sessionId: string, tabId: string) {
    this.config = config;
    this.sessionId = sessionId;
    this.tabId = tabId;
    this.provider = this.createProvider();
  }

  private createProvider(): WebTracerProvider {
    const { serviceName, resourceAttributes, exporterEndpoint, projectId } =
      this.config;

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      "at-project-id": projectId,
      ...(resourceAttributes || {}),
    });

    const otlpExporter = new OTLPTraceExporter({
      url: exporterEndpoint || "https://otelcol.apitoolkit.io/v1/traces",
      headers: {},
    });

    return new WebTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(otlpExporter)],
    });
  }

  public configure(): void {
    this.provider.register({
      contextManager: new ZoneContextManager(),
      propagator: new W3CTraceContextPropagator(),
    });

    const headerUrls = this.config.propagateTraceHeaderCorsUrls || [
      /^https?:\/\/.*/,
    ];
    const ignoreUrls = [
      /^https?:\/\/(?:[^\/]+\.)?apitoolkit\.io\//,
      /^https?:\/\/(?:[^\/]+\.)?monoscope\.tech\//,
    ];

    registerInstrumentations({
      tracerProvider: this.provider,
      instrumentations: [
        ...(this.config.instrumentations || []),
        new DocumentLoadInstrumentation({
          ignoreNetworkEvents: !this.config.enableNetworkEvents,
          applyCustomAttributesOnSpan: {
            documentLoad: (span) => {
              span.setAttribute("session.id", this.sessionId);
              span.setAttribute("tab.id", this.tabId);
              this.setUserAttributes(span);
            },
          },
        }),
        new XMLHttpRequestInstrumentation({
          propagateTraceHeaderCorsUrls: headerUrls,
          ignoreUrls,
          applyCustomAttributesOnSpan: (span) => {
            span.setAttribute("session.id", this.sessionId);
            span.setAttribute("tab.id", this.tabId);
            this.setUserAttributes(span);
          },
        }),
        new FetchInstrumentation({
          propagateTraceHeaderCorsUrls: headerUrls,
          ignoreUrls,
          applyCustomAttributesOnSpan: (span) => {
            span.setAttribute("session.id", this.sessionId);
            span.setAttribute("tab.id", this.tabId);
            this.setUserAttributes(span);
          },
        }),
      ],
    });
  }

  private setUserAttributes(span: any) {
    if (this.config.user) {
      for (let k in this.config.user) {
        span.setAttribute(`user.${k}`, this.config.user[k]);
      }
    }
  }

  public updateSessionId(sessionId: string) {
    this.sessionId = sessionId;
  }

  public async shutdown(): Promise<void> {
    await this.provider.shutdown();
  }

  public setUser(newConfig: MonoscopeUser) {
    this.config = {
      ...this.config,
      user: { ...this.config.user, ...newConfig },
    };
  }
}
