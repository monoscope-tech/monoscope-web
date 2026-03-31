# Monoscope Browser SDK

The **Monoscope Browser SDK** is a lightweight JavaScript library for adding **session replay**, **performance tracing**, **error tracking**, and **web vitals** to your web applications.

When used together with the [Monoscope Server SDKs](https://monoscope.tech/docs/sdks/), you gain **end-to-end observability** — seamlessly connecting user interactions in the browser to backend services, APIs, and databases.

This means you can:

- **Replay user sessions** to see exactly what happened.
- **Trace requests** from the frontend, through your backend, and into your database.
- **Capture errors and console logs** with full context and breadcrumbs for faster debugging.
- **Collect Web Vitals** (CLS, INP, LCP, FCP, TTFB) automatically.
- **Track SPA navigations** across pushState, replaceState, and popstate.

---

## Installation

Install via **npm/bun**:

```bash
npm install @monoscopetech/browser
```

Or include it directly in your HTML using a `<script>` tag:

```html
<script src="https://unpkg.com/@monoscopetech/browser@latest/dist/monoscope.min.js"></script>
```

---

## Quick Start

Initialize Monoscope with your **project ID** and configuration:

```javascript
import Monoscope from "@monoscopetech/browser";

const monoscope = new Monoscope({
  projectId: "YOUR_PROJECT_ID",
  serviceName: "my-web-app",
});

// Identify the current user
monoscope.setUser({
  id: "user-123",
  email: "user@example.com",
});
```

---

## Configuration

The `Monoscope` constructor accepts the following options:

| Name | Type | Description |
| --- | --- | --- |
| `projectId` | `string` | **Required** – Your Monoscope project ID. |
| `serviceName` | `string` | **Required** – Name of your service or application. |
| `exporterEndpoint` | `string` | Endpoint for exporting traces. Defaults to Monoscope's ingest endpoint. |
| `propagateTraceHeaderCorsUrls` | `RegExp[]` | URL patterns where trace context headers should be propagated. Defaults to same-origin only. |
| `resourceAttributes` | `Record<string, string>` | Additional OpenTelemetry resource attributes. |
| `instrumentations` | `unknown[]` | Additional OpenTelemetry instrumentations to register. |
| `replayEventsBaseUrl` | `string` | Base URL for session replay events. Defaults to Monoscope's ingest endpoint. |
| `enableNetworkEvents` | `boolean` | Include network timing events in document load spans. |
| `user` | `MonoscopeUser` | Default user information for the session. |
| `debug` | `boolean` | Enable debug logging to the console. |
| `sampleRate` | `number` | Trace sampling rate from `0` to `1`. Default `1` (100%). |
| `replaySampleRate` | `number` | Replay sampling rate from `0` to `1`. Default `1` (100%). |
| `enabled` | `boolean` | Whether to start collecting data immediately. Default `true`. |
| `resourceTimingThresholdMs` | `number` | Minimum resource duration (ms) to report. Default `200`. |
| `enableUserInteraction` | `boolean` | Trace user clicks and interactions, linking them to downstream network calls. Default `false`. |

---

### User Object

The `MonoscopeUser` object can contain:

| Name | Type | Description |
| --- | --- | --- |
| `email` | `string` | User's email address. |
| `full_name` | `string` | User's full name. |
| `name` | `string` | User's preferred name. |
| `id` | `string` | User's unique identifier. |
| `roles` | `string[]` | User's roles. |

Additional string-keyed attributes are also accepted and forwarded as custom user attributes.

---

## API

### `setUser(user: MonoscopeUser)`

Associates the given user with the current session. Can be called at any time.

```javascript
monoscope.setUser({
  id: "user-123",
  email: "user@example.com",
});
```

### `startSpan<T>(name: string, fn: (span: Span) => T): T`

Creates a custom OpenTelemetry span. The span is automatically ended when the function returns. Supports async functions.

```javascript
monoscope.startSpan("checkout", (span) => {
  span.setAttribute("cart.items", 3);
  // ... your logic
});
```

### `recordEvent(name: string, attributes?: Record<string, string | number | boolean>)`

Records a custom event as a span with the given attributes.

```javascript
monoscope.recordEvent("button_click", {
  "button.name": "subscribe",
  "button.variant": "primary",
});
```

### `getSessionId(): string`

Returns the current session ID.

### `getTabId(): string`

Returns the current tab ID (unique per browser tab).

### `enable()` / `disable()`

Dynamically enable or disable all data collection.

```javascript
monoscope.disable(); // pause collection
monoscope.enable();  // resume collection
```

### `isEnabled(): boolean`

Returns whether the SDK is currently enabled.

### `destroy(): Promise<void>`

Stops all collection, flushes pending data, and shuts down the OpenTelemetry provider. Call this when your application is being torn down.

```javascript
await monoscope.destroy();
```

---

## React / Next.js

For React apps, use the `@monoscopetech/browser/react` subpath export for idiomatic integration with hooks and context.

```tsx
import { MonoscopeProvider, useMonoscope, useMonoscopeUser, MonoscopeErrorBoundary } from "@monoscopetech/browser/react";

// Wrap your app with MonoscopeProvider
function App() {
  return (
    <MonoscopeProvider config={{ projectId: "YOUR_PROJECT_ID", serviceName: "my-react-app" }}>
      <MonoscopeErrorBoundary fallback={<div>Something went wrong</div>}>
        <MyApp />
      </MonoscopeErrorBoundary>
    </MonoscopeProvider>
  );
}

// Access the instance via hook
function MyApp() {
  const monoscope = useMonoscope();

  // Reactively set user when auth state changes
  useMonoscopeUser(currentUser ? { id: currentUser.id, email: currentUser.email } : null);

  return <div>...</div>;
}
```

**Next.js App Router**: The provider includes `"use client"` — import it in a client component or your root layout.

### React API

| Export | Description |
| --- | --- |
| `MonoscopeProvider` | Context provider. Creates and destroys the SDK instance. Strict Mode safe. |
| `useMonoscope()` | Returns the `Monoscope` instance (or `null` during SSR). |
| `useMonoscopeUser(user)` | Calls `setUser` reactively when the user object changes. |
| `MonoscopeErrorBoundary` | Error boundary that reports caught errors to Monoscope. Accepts `fallback` prop. |

---

## Custom Instrumentation

### Custom Spans

Use `startSpan()` to instrument specific operations with timing and attributes. It supports both sync and async functions — the span is automatically ended when the function returns or the promise resolves.

```javascript
// Sync
monoscope.startSpan("parse-config", (span) => {
  span.setAttribute("config.size", rawConfig.length);
  return parseConfig(rawConfig);
});

// Async
const data = await monoscope.startSpan("fetch-dashboard", async (span) => {
  span.setAttribute("dashboard.id", dashboardId);
  const res = await fetch(`/api/dashboards/${dashboardId}`);
  span.setAttribute("http.status", res.status);
  return res.json();
});
```

### Custom Events

Use `recordEvent()` to track discrete events without wrapping a code block:

```javascript
monoscope.recordEvent("feature_flag_evaluated", {
  "flag.name": "new-checkout",
  "flag.value": true,
});
```

### React Components

Use the `useMonoscope()` hook to instrument React components:

```tsx
import { useMonoscope } from "@monoscopetech/browser/react";

function CheckoutButton() {
  const monoscope = useMonoscope();

  const handleClick = () => {
    monoscope?.startSpan("checkout.submit", async (span) => {
      span.setAttribute("cart.items", cartItems.length);
      await submitOrder();
    });
  };

  return <button onClick={handleClick}>Checkout</button>;
}
```

### Additional OpenTelemetry Instrumentations

Pass extra OTel instrumentations via the `instrumentations` config to extend tracing beyond the built-in set:

```javascript
import { LongTaskInstrumentation } from "@opentelemetry/instrumentation-long-task";

const monoscope = new Monoscope({
  projectId: "YOUR_PROJECT_ID",
  serviceName: "my-app",
  instrumentations: [new LongTaskInstrumentation()],
});
```

---

## Features

### Session Replay
Captures DOM changes via [rrweb](https://github.com/rrweb-io/rrweb) to enable full session replay. Sensitive inputs are masked by default.

### Error Tracking
Automatically captures `window.onerror`, unhandled promise rejections, and `console.error` calls with stack traces and breadcrumbs.

### SPA Navigation Tracking
Detects client-side navigations (`pushState`, `replaceState`, `popstate`) and emits navigation spans.

### Web Vitals
Collects Core Web Vitals (CLS, INP, LCP) and additional metrics (FCP, TTFB) via the [web-vitals](https://github.com/GoogleChrome/web-vitals) library.

### Performance Observers
Reports long tasks and slow resource loads as spans for performance debugging.

### Session Management
Sessions persist across page reloads via `sessionStorage` and automatically rotate after 30 minutes of inactivity.

---

## License

This SDK is licensed under the [MIT License](LICENSE).
