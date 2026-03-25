import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MonoscopeProvider, useMonoscope, useMonoscopeUser, MonoscopeErrorBoundary } from "../react";

// Mock Monoscope class — avoid pulling in real OpenTelemetry/rrweb in tests
const destroyMock = vi.fn().mockResolvedValue(undefined);
const setUserMock = vi.fn();
const recordEventMock = vi.fn();

vi.mock("..", () => {
  return {
    default: class MockMonoscope {
      destroy = destroyMock;
      setUser = setUserMock;
      recordEvent = recordEventMock;
      getSessionId = () => "test-session-id";
      getTabId = () => "test-tab-id";
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MonoscopeProvider", () => {
  it("provides a Monoscope instance to children", () => {
    function Child() {
      const m = useMonoscope();
      return <div data-testid="sid">{m?.getSessionId()}</div>;
    }
    render(
      <MonoscopeProvider config={{ projectId: "test", serviceName: "test" }}>
        <Child />
      </MonoscopeProvider>,
    );
    expect(screen.getByTestId("sid")).toHaveTextContent("test-session-id");
  });

  it("returns null outside provider", () => {
    function Orphan() {
      const m = useMonoscope();
      return <div data-testid="val">{m === null ? "null" : "instance"}</div>;
    }
    render(<Orphan />);
    expect(screen.getByTestId("val")).toHaveTextContent("null");
  });
});

describe("useMonoscopeUser", () => {
  it("calls setUser when user changes", () => {
    const user = { id: "u1", email: "a@b.com" };
    function Child() {
      useMonoscopeUser(user);
      return <div>ok</div>;
    }
    render(
      <MonoscopeProvider config={{ projectId: "test", serviceName: "test" }}>
        <Child />
      </MonoscopeProvider>,
    );
    expect(setUserMock).toHaveBeenCalledWith(user);
  });

  it("skips setUser when user is null", () => {
    function Child() {
      useMonoscopeUser(null);
      return <div>ok</div>;
    }
    render(
      <MonoscopeProvider config={{ projectId: "test", serviceName: "test" }}>
        <Child />
      </MonoscopeProvider>,
    );
    expect(setUserMock).not.toHaveBeenCalled();
  });
});

describe("MonoscopeErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <MonoscopeProvider config={{ projectId: "test", serviceName: "test" }}>
        <MonoscopeErrorBoundary fallback={<div>error</div>}>
          <div data-testid="child">hello</div>
        </MonoscopeErrorBoundary>
      </MonoscopeProvider>,
    );
    expect(screen.getByTestId("child")).toHaveTextContent("hello");
  });

  it("renders fallback and reports error when child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Boom() {
      throw new Error("test boom");
    }
    render(
      <MonoscopeProvider config={{ projectId: "test", serviceName: "test" }}>
        <MonoscopeErrorBoundary fallback={<div data-testid="fb">caught</div>}>
          <Boom />
        </MonoscopeErrorBoundary>
      </MonoscopeProvider>,
    );
    expect(screen.getByTestId("fb")).toHaveTextContent("caught");
    expect(recordEventMock).toHaveBeenCalledWith(
      "react.error_boundary",
      expect.objectContaining({ "error.message": "test boom" }),
    );
    spy.mockRestore();
  });

  it("renders fallback function with error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Boom() {
      throw new Error("fn boom");
    }
    render(
      <MonoscopeProvider config={{ projectId: "test", serviceName: "test" }}>
        <MonoscopeErrorBoundary fallback={(err) => <div data-testid="fb">{err.message}</div>}>
          <Boom />
        </MonoscopeErrorBoundary>
      </MonoscopeProvider>,
    );
    expect(screen.getByTestId("fb")).toHaveTextContent("fn boom");
    spy.mockRestore();
  });

  it("renders null when no fallback provided", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Boom() {
      throw new Error("no fallback");
    }
    const { container } = render(
      <MonoscopeProvider config={{ projectId: "test", serviceName: "test" }}>
        <MonoscopeErrorBoundary>
          <Boom />
        </MonoscopeErrorBoundary>
      </MonoscopeProvider>,
    );
    expect(container.innerHTML).toBe("");
    spy.mockRestore();
  });
});
