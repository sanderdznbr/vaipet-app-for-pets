import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { WaitingForAcceptance } from "./WaitingForAcceptance";

// Mapbox is instantiated on mount and needs WebGL — stub it out entirely.
vi.mock("mapbox-gl", () => {
  class Map {
    on(evt: string, cb: () => void) {
      if (evt === "load") cb();
      return this;
    }
    remove() {}
    getStyle() {
      return { layers: [] };
    }
    setConfigProperty() {}
    setPaintProperty() {}
    setLayoutProperty() {}
  }
  return { default: { Map, accessToken: "" }, Map };
});

vi.mock("@/lib/mapStyle", () => ({
  hideMapLabels: vi.fn(),
  enrichMap: vi.fn(),
  tintMapInk: vi.fn(),
}));

const renderWaiting = (props: Partial<Parameters<typeof WaitingForAcceptance>[0]> = {}) => {
  const onAccepted = vi.fn();
  const onTimeout = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <WaitingForAcceptance
      onAccepted={onAccepted}
      onTimeout={onTimeout}
      onCancel={onCancel}
      petwalkerName="João"
      userLocation={[-46.6333, -23.5505]}
      {...props}
    />,
  );
  return { onAccepted, onTimeout, onCancel, ...utils };
};

describe("WaitingForAcceptance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("mostra o estado Aguardando com o nome do petwalker e o contador", () => {
    renderWaiting();
    expect(screen.getByText("Aguardando")).toBeInTheDocument();
    expect(screen.getByText(/João • 5:00/)).toBeInTheDocument();
  });

  it("dispara onAccepted exatamente uma vez, mesmo com o tempo avançando muito além", () => {
    const { onAccepted, onTimeout } = renderWaiting();

    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(onAccepted).toHaveBeenCalledTimes(1);

    // Anti-flicker: nenhum disparo extra depois da aceitação.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onAccepted).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("não aceita antes do tempo previsto", () => {
    const { onAccepted } = renderWaiting();
    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("limpa os timers no unmount, sem callbacks fantasmas", () => {
    const { onAccepted, onTimeout, unmount } = renderWaiting();
    unmount();
    act(() => {
      vi.advanceTimersByTime(600_000);
    });
    expect(onAccepted).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
