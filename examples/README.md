# Examples

## Vanilla JS

Open `vanilla/index.html` directly in a browser, or serve it:

```bash
cd examples/vanilla
npx serve .
```

Click the buttons to record events, set user, create spans, or trigger errors. Debug output is logged to the on-screen console (the SDK is initialized with `debug: true`).

## React

```bash
cd examples/react-app
pnpm install
pnpm dev
```

Opens a Vite dev server. The app runs in Strict Mode to verify the provider handles mount/unmount correctly. Buttons demo:

- **Record Event** — calls `recordEvent`
- **Set User** — calls `useMonoscopeUser` hook reactively
- **Custom Span** — creates a span via `startSpan`
- **Trigger Error Boundary** — renders a component that throws, caught by `MonoscopeErrorBoundary`

Both examples use `debug: true` so all SDK activity is logged to the browser console.
