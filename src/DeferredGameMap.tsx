import { Component, lazy, Suspense, type ReactNode } from "react";
import type { GameMapProps } from "./GameMap";
const MapView = lazy(() =>
  import("./GameMap").then((module) => ({ default: module.GameMap })),
);
export class MapBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="map-loading map-failure" role="alert">
          <strong>The map could not open.</strong>
          <p>Your inventory and wallet are still available.</p>
          <button
            className="secondary-button"
            onClick={() => window.location.reload()}
          >
            Reload game
          </button>
        </div>
      );
    return this.props.children;
  }
}
export function DeferredGameMap(props: GameMapProps) {
  return (
    <MapBoundary>
      <Suspense
        fallback={
          <div className="map-loading" role="status">
            Preparing the map…
          </div>
        }
      >
        <MapView {...props} />
      </Suspense>
    </MapBoundary>
  );
}
