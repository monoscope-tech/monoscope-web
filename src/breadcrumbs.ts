const MAX_BREADCRUMBS = 20;

export type Breadcrumb = {
  type: "click" | "navigation" | "console.error" | "http" | "custom";
  message: string;
  timestamp: number;
  data?: Record<string, string>;
};

const buffer: Breadcrumb[] = [];

export function addBreadcrumb(crumb: Omit<Breadcrumb, "timestamp">) {
  buffer.push({ ...crumb, timestamp: Date.now() });
  if (buffer.length > MAX_BREADCRUMBS) buffer.shift();
}

export function getBreadcrumbs(): Breadcrumb[] {
  return buffer.slice();
}

export function clearBreadcrumbs() {
  buffer.length = 0;
}
