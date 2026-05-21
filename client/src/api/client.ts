import { create } from "zustand";
import {
  Calibration,
  DistanceId,
  EventLogEntry,
  MatchState,
  ResolveTurnRequest,
  SetupMatchRequest,
  Team,
  TurnOutcome,
} from "../types";

interface ApiClientState {
  state: MatchState | null;
  eventLog: EventLogEntry[];
  updateState: (newState: MatchState) => void;
  updateSensorValue: (raw: number, normalized: number) => void;
  setEventLog: (entries: EventLogEntry[]) => void;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? ((await response.json()) as unknown)
    : null;

  if (!response.ok) {
    if (
      body &&
      typeof body === "object" &&
      "errors" in body &&
      Array.isArray((body as { errors?: unknown }).errors)
    ) {
      throw new Error(((body as { errors: string[] }).errors).join("\n"));
    }
    if (body && typeof body === "object" && "error" in body) {
      throw new Error(String((body as { error: unknown }).error));
    }
    throw new Error(`Request failed: ${response.status}`);
  }

  return body as T;
}

export const apiClient = {
  getState(): Promise<MatchState> {
    return apiRequest<MatchState>("/api/state");
  },

  saveSetup(payload: SetupMatchRequest): Promise<{ success: true }> {
    return apiRequest("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  startMatch(firstThrowingTeam?: Team): Promise<{ success: true }> {
    return apiRequest("/api/control/start-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(firstThrowingTeam ? { firstThrowingTeam } : {}),
    });
  },

  startOvertime(firstThrowingTeam?: Team): Promise<{ success: true }> {
    return apiRequest("/api/control/start-overtime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(firstThrowingTeam ? { firstThrowingTeam } : {}),
    });
  },

  resetMatch(): Promise<{ success: true }> {
    return apiRequest("/api/control/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  },

  selectShooter(playerId: string): Promise<{ success: true }> {
    return apiRequest("/api/selection/shooter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
  },

  selectDistance(distanceId: DistanceId): Promise<{ success: true }> {
    return apiRequest("/api/selection/distance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ distanceId }),
    });
  },

  selectBall(ballId: string): Promise<{ success: true }> {
    return apiRequest("/api/selection/ball", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ballId }),
    });
  },

  selectBonus(bonusChoice: "distance" | "opponentAverage"): Promise<{ success: true }> {
    return apiRequest("/api/selection/bonus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bonusChoice }),
    });
  },

  startTurn(): Promise<{ success: true }> {
    return apiRequest("/api/control/start-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  },

  reviewTurn(): Promise<{ success: true }> {
    return apiRequest("/api/control/review-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  },

  resolveTurn(payload: ResolveTurnRequest): Promise<{ success: true }> {
    return apiRequest("/api/control/resolve-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  adjustFoul(team: Team, delta: -1 | 1): Promise<{ success: true }> {
    return apiRequest("/api/control/adjust-foul", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team, delta }),
    });
  },

  adjustBall(team: Team, ballId: string, delta: -1 | 1): Promise<{ success: true }> {
    return apiRequest("/api/control/adjust-ball", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team, ballId, delta }),
    });
  },

  updateCalibration(payload: Calibration): Promise<{ success: true }> {
    return apiRequest("/api/calibration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  captureCalibrationEmpty(): Promise<{ success: true; calibration: Calibration }> {
    return apiRequest("/api/calibration/capture-empty", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  },

  captureCalibrationBlocked(): Promise<{ success: true; calibration: Calibration }> {
    return apiRequest("/api/calibration/capture-blocked", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  },

  autoCalibrate(): Promise<{ success: true; calibration: Calibration }> {
    return apiRequest("/api/control/auto-calibrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  },
};

export const useApiStore = create<ApiClientState>((set) => ({
  state: null,
  eventLog: [],
  updateState: (newState) =>
    set((current) => ({
      ...current,
      state: newState,
    })),
  updateSensorValue: (raw, normalized) =>
    set((current) => {
      if (!current.state) {
        return current;
      }

      return {
        ...current,
        state: {
          ...current.state,
          sensor: {
            ...current.state.sensor,
            latestRaw: raw,
            latestNormalized: normalized,
          },
        },
      };
    }),
  setEventLog: (entries) =>
    set((current) => ({
      ...current,
      eventLog: entries.slice(-100),
    })),
}));
