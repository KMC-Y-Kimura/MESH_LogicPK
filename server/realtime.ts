import { WebSocket } from "ws";
import { EventLogEntry, MatchState } from "./types";

export type RealtimeEventType = "stateUpdate" | "sensorValue" | "eventLog";

export interface RealtimeEvent {
  type: RealtimeEventType;
  payload: unknown;
  timestamp: number;
}

export class RealtimeManager {
  private clients: Set<WebSocket> = new Set();

  addClient(ws: WebSocket): void {
    this.clients.add(ws);

    ws.on("close", () => {
      this.clients.delete(ws);
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
      this.clients.delete(ws);
    });
  }

  broadcast(event: RealtimeEvent): void {
    const message = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  broadcastStateUpdate(state: MatchState): void {
    this.broadcast({
      type: "stateUpdate",
      payload: state,
      timestamp: Date.now(),
    });
  }

  broadcastSensorValue(raw: number, normalized: number): void {
    this.broadcast({
      type: "sensorValue",
      payload: { raw, normalized },
      timestamp: Date.now(),
    });
  }

  broadcastEventLog(entries: EventLogEntry[]): void {
    this.broadcast({
      type: "eventLog",
      payload: entries,
      timestamp: Date.now(),
    });
  }
}

export const realtimeManager = new RealtimeManager();
