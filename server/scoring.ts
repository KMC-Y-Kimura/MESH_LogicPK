import {
  BonusChoice,
  Calibration,
  DistanceId,
  Team,
  TurnScoreBreakdown,
  Winner,
  WinnerReason,
} from "./types";

export const DISTANCE_POINTS: Record<DistanceId, number> = {
  near: 1,
  middle: 2,
  far: 4,
};

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

export function getDistancePoints(distanceId: DistanceId): number {
  return DISTANCE_POINTS[distanceId];
}

export function calculateSuccessBreakdown(params: {
  throwingTeam: Team;
  defendingTeam: Team;
  shooterBasePoints: number;
  distanceId: DistanceId;
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
