import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { MonoscopeConfig } from "./types";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

export const configureOpenTelemetry = (
  config: MonoscopeConfig,
  sessionId: string
) => {
  const {
    serviceName,
    resourceAttributes,
    instrumentations = [],
    propagateTraceHeaderCorsUrls,
  } = config;

  const SESSION_ID = sessionId;

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    "at-project-id": config.projectId,
    ...(resourceAttributes || {}),
  });

  const otlpExporter = new OTLPTraceExporter({
    url: config.exporterEndpoint || "http://otelcol.apitoolkit.io:4318", // HTTP endpoint (note the :4318 port)
    headers: {},
  });

  const provider = new WebTracerProvider({
    resource: resource,
    spanProcessors: [new BatchSpanProcessor(otlpExporter)],
  });

  provider.register({
    contextManager: new ZoneContextManager(),
    propagator: new W3CTraceContextPropagator(),
  });

  const headerUrls = propagateTraceHeaderCorsUrls || [/^https?:\/\/.*/];

  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      ...instrumentations,
      new DocumentLoadInstrumentation({
        applyCustomAttributesOnSpan: {
          documentLoad: (span) => {
            span.setAttribute("session.id", SESSION_ID);
          },
        },
      }),
      new XMLHttpRequestInstrumentation({
        propagateTraceHeaderCorsUrls: headerUrls,
        applyCustomAttributesOnSpan: (span, xhr) => {
          span.setAttribute("session.id", SESSION_ID);
        },
      }),
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: headerUrls,
        applyCustomAttributesOnSpan: (span, request) => {
          span.setAttribute("session.id", SESSION_ID);
        },
      }),
    ],
  });
};
