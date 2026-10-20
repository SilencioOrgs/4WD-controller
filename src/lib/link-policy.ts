export function reconnectDelay(attempt: number) {
  return Math.min(1500, 250 * (2 ** Math.max(0, Math.min(attempt, 3))));
}
export function selectTransport(wsOpen: boolean, fallbackReady: boolean): "ws" | "http" | null {
  return wsOpen ? "ws" : fallbackReady ? "http" : null;
}
