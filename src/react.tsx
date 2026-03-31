"use client";

import { createContext, useContext, useRef, useEffect, Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import Monoscope from ".";
import type { MonoscopeConfig, MonoscopeUser } from "./types";

const MonoscopeContext = createContext<Monoscope | null>(null);

type ProviderProps = { children: ReactNode } & (
  | { config: MonoscopeConfig }
  | ({ config?: undefined } & MonoscopeConfig)
);

export function MonoscopeProvider({ children, ...rest }: ProviderProps) {
  const config: MonoscopeConfig = rest.config ?? rest as MonoscopeConfig;
  const ref = useRef<Monoscope | null>(null);
  if (!ref.current && typeof window !== "undefined") {
    ref.current = new Monoscope(config);
  }

  useEffect(() => {
    const instance = ref.current;
    if (!instance) return;
    // Deferred destroy — cleared if Strict Mode remounts immediately
    let timer: ReturnType<typeof setTimeout>;
    return () => {
      timer = setTimeout(() => { instance.destroy(); ref.current = null; }, 0);
      return void timer;
    };
  }, []);

  return <MonoscopeContext.Provider value={ref.current}>{children}</MonoscopeContext.Provider>;
}

export function useMonoscope(): Monoscope | null {
  return useContext(MonoscopeContext);
}

export function useMonoscopeUser(user: MonoscopeUser | null | undefined) {
  const instance = useMonoscope();
  useEffect(() => {
    if (instance && user) instance.setUser(user);
  }, [instance, user]);
}

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error) => ReactNode);
};
type ErrorBoundaryState = { error: Error | null };

export class MonoscopeErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  static contextType = MonoscopeContext;
  declare context: Monoscope | null;
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.context?.recordEvent("react.error_boundary", {
      "error.message": error.message,
      "error.stack": error.stack ?? "",
      "error.component_stack": info.componentStack ?? "",
    });
  }

  render() {
    if (this.state.error) {
      const { fallback } = this.props;
      if (typeof fallback === "function") return fallback(this.state.error);
      return fallback ?? null;
    }
    return this.props.children;
  }
}
