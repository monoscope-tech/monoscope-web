// Must evaluate before zone.js (imported by @opentelemetry/context-zone). Zone rebuilds
// IntersectionObserver from a `for…in` over an instance; where its methods are not enumerable
// the host page's observers lose `observe`. No OTel context needs to flow through it.
(globalThis as any).__Zone_disable_IntersectionObserver ??= true;
export {};
