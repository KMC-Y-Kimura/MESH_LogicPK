import {
  BonusChoice,
  Calibration,
  DistanceMeter,
  Team,
  TurnScoreBreakdown,
  Winner,
  WinnerReason,
} from "./types";

export const DISTANCE_MIN_METER = 1;
export const DISTANCE_MAX_METER = 15;
export const DISTANCE_OPTIONS: DistanceMeter[] = Array.from(
  { length: DISTANCE_MAX_METER - DISTANCE_MIN_METER + 1 },
  (_, index) => DISTANCE_MIN_METER + index
);

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeGoalSensor(raw: number, calibration: Calibration): number {
  const { minRaw, emptyRaw } = calibration;
  if (emptyRaw === minRaw) {
    return 0;
  }

  const normalized = ((raw - minRaw) / (emptyRaw - minRaw)) * 100;
  return clamp(normalized, 0, 100);
}

export function getExpectedTotalBasePoints(playerCount: number): number {
  return Math.ceil(playerCount * 2.5);
}

export function calculateAverageBasePoints(totalBasePoints: number, playerCount: number): number {
  if (playerCount <= 0) {
    return 0;
  }
  return totalBasePoints / playerCount;
}

export function isValidDistanceMeter(distance: number): distance is DistanceMeter {
  return Number.isInteger(distance) && distance >= DISTANCE_MIN_METER && distance <= DISTANCE_MAX_METER;
}

export function getDistancePoints(distanceId: DistanceMeter): number {
  return distanceId;
}

export function calculateSuccessBreakdown(params: {
  throwingTeam: Team;
  defendingTeam: Team;
  shooterBasePoints: number;
  distanceId: DistanceMeter;
  bonusChoice: BonusChoice;
  defendingAverageBasePoints: number;
}): TurnScoreBreakdown {
  const {
    throwingTeam,
    defendingTeam,
    shooterBasePoints,
    distanceId,
    bonusChoice,
    defendingAverageBasePoints,
  } = params;

  let distancePoints = 0;
  let opponentAveragePoints = 0;
  let redDelta = 0;
  let blueDelta = 0;

  if (throwingTeam === "red") {
    redDelta += shooterBasePoints;
  } else {
    blueDelta += shooterBasePoints;
  }

  if (bonusChoice === "distance") {
    distancePoints = getDistancePoints(distanceId);
    if (throwingTeam === "red") {
      redDelta += distancePoints;
    } else {
      blueDelta += distancePoints;
    }
  } else {
    opponentAveragePoints = defendingAverageBasePoints;
    if (defendingTeam === "red") {
      redDelta += opponentAveragePoints;
    } else {
      blueDelta += opponentAveragePoints;
    }
  }

  return {
    shooterBasePoints,
    distancePoints,
    opponentAveragePoints,
    redDelta,
    blueDelta,
  };
}

export function determineWinner(params: {
  redRawScore: number;
  blueRawScore: number;
  redFouls: number;
  blueFouls: number;
  redDisqualified: boolean;
  blueDisqualified: boolean;
}): { winner: Winner; reason: WinnerReason; redDisplayScore: number; blueDisplayScore: number } {
  const {
    redRawScore,
    blueRawScore,
    redFouls,
    blueFouls,
    redDisqualified,
    blueDisqualified,
  } = params;

  const redDisplayScore = Math.ceil(redRawScore);
  const blueDisplayScore = Math.ceil(blueRawScore);

  if (redDisqualified && !blueDisqualified) {
    return { winner: "blue", reason: "disqualification", redDisplayScore, blueDisplayScore };
  }
  if (blueDisqualified && !redDisqualified) {
    return { winner: "red", reason: "disqualification", redDisplayScore, blueDisplayScore };
  }
  if (redDisqualified && blueDisqualified) {
    return { winner: "draw", reason: null, redDisplayScore, blueDisplayScore };
  }

  if (redDisplayScore > blueDisplayScore) {
    return { winner: "red", reason: "roundedScore", redDisplayScore, blueDisplayScore };
  }
  if (blueDisplayScore > redDisplayScore) {
    return { winner: "blue", reason: "roundedScore", redDisplayScore, blueDisplayScore };
  }

  if (redRawScore > blueRawScore) {
    return { winner: "red", reason: "rawScore", redDisplayScore, blueDisplayScore };
  }
  if (blueRawScore > redRawScore) {
    return { winner: "blue", reason: "rawScore", redDisplayScore, blueDisplayScore };
  }

  if (redFouls < blueFouls) {
    return { winner: "red", reason: "fouls", redDisplayScore, blueDisplayScore };
  }
  if (blueFouls < redFouls) {
    return { winner: "blue", reason: "fouls", redDisplayScore, blueDisplayScore };
  }

  return { winner: "draw", reason: null, redDisplayScore, blueDisplayScore };
}
