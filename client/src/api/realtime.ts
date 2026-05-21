import { create } from "zustand";
import { useApiStore } from "./client";
import { EventLogEntry, MatchState, RealtimeEvent } from "../types";

interface RealtimeState {
  connected: boolean;
  ws: WebSocket | null;
  connect: () => void;
  disconnect: () => void;
}

function getWebSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = import.meta.env.DEV
    ? `${window.location.hostname}:3000`
    : window.location.host;
  return `${protocol}://${host}`;
}

export const useRealtimeStore = create<RealtimeState>((set, get) => ({
  connected: false,
  ws: null,
  connect: () => {
    const { connected, ws } = get();
    if (connected || ws) {
      return;
    }

    const socket = new WebSocket(getWebSocketUrl());

    socket.onopen = () => {
      set({ connected: true });
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as RealtimeEvent;
        handleRealtimeEvent(message);
      } catch (error) {
        console.error("Failed to parse realtime message:", error);
      }
    };

    socket.onclose = () => {
      set({ connected: false, ws: null });
      window.setTimeout(() => {
        if (!get().connected) {
          get().connect();
        }
      }, 3000);
    };

    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    set({ ws: socket });
  },
  disconnect: () => {
    const { ws } = get();
    if (ws) {
      ws.close();
    }
    set({ connected: false, ws: null });
  },
}));

function handleRealtimeEvent(event: RealtimeEvent): void {
  const { updateState, updateSensorValue, setEventLog } = useApiStore.getState();

  switch (event.type) {
    case "stateUpdate":
      updateState(event.payload as MatchState);
      return;
    case "sensorValue": {
      const payload = event.payload as { raw: number; normalized: number };
      updateSensorValue(payload.raw, payload.normalized);
      return;
    }
    case "eventLog":
      setEventLog(event.payload as EventLogEntry[]);
      return;
    default:
      return;
  }
}
