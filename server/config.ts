import fs from "fs";
import path from "path";
import { Calibration } from "./types";

const CONFIG_DIR = ".";
const CALIBRATION_FILE = path.join(CONFIG_DIR, "calibration.json");

export interface Config {
  PORT: number;
  HOST: string;
  MAX_LOG_ENTRIES: number;
}

export const defaultConfig: Config = {
  PORT: 3000,
  HOST: "0.0.0.0",
  MAX_LOG_ENTRIES: 100,
};

export const defaultCalibration: Calibration = {
  minRaw: 0,
  emptyRaw: 900,
  triggerThreshold: 35,
};

export function loadCalibration(): Calibration {
  try {
    if (!fs.existsSync(CALIBRATION_FILE)) {
      return { ...defaultCalibration };
    }

    const data = fs.readFileSync(CALIBRATION_FILE, "utf-8");
    const parsed = JSON.parse(data) as unknown;

    if (isCalibration(parsed)) {
      return parsed;
    }

    // Backward compatibility with the previous red/blue calibration file.
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "red" in parsed &&
      isLegacyCalibration((parsed as Record<string, unknown>).red)
    ) {
      const legacy = (parsed as Record<string, { minRaw: number; emptyRaw: number }>).red;
      return {
        minRaw: legacy.minRaw,
        emptyRaw: legacy.emptyRaw,
        triggerThreshold: defaultCalibration.triggerThreshold,
      };
    }
  } catch (error) {
    console.warn("Failed to load calibration file, using defaults:", error);
  }

  return { ...defaultCalibration };
}

export function saveCalibration(calibration: Calibration): void {
  try {
    fs.writeFileSync(CALIBRATION_FILE, JSON.stringify(calibration, null, 2));
    console.log("Calibration saved to", CALIBRATION_FILE);
  } catch (error) {
    console.error("Failed to save calibration:", error);
  }
}

function isCalibration(value: unknown): value is Calibration {
  if (!isLegacyCalibration(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.triggerThreshold === "number" && !Number.isNaN(record.triggerThreshold);
}

function isLegacyCalibration(value: unknown): value is { minRaw: number; emptyRaw: number } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.minRaw === "number" &&
    typeof record.emptyRaw === "number" &&
    !Number.isNaN(record.minRaw) &&
    !Number.isNaN(record.emptyRaw)
  );
}
