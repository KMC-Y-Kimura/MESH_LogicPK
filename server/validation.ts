import {
  AdjustBallRequest,
  AdjustFoulRequest,
  BonusChoice,
  CalibrationRequest,
  DistanceId,
  MeshButtonRequest,
  ResolveTurnRequest,
  SelectBallRequest,
  SelectBonusRequest,
  SelectDistanceRequest,
  SelectShooterRequest,
  SensorValueRequest,
  SetupMatchRequest,
  StartMatchRequest,
  StartOvertimeRequest,
  Team,
  TurnOutcome,
} from "./types";

interface ValidationError {
  valid: false;
  errors: string[];
}

interface ValidationSuccess {
  valid: true;
}

type ValidationResult = ValidationError | ValidationSuccess;

const VALID_TEAMS: Team[] = ["red", "blue"];
const VALID_DISTANCES: DistanceId[] = ["near", "middle", "far"];
const VALID_BONUS_CHOICES: BonusChoice[] = ["distance", "opponentAverage"];
const VALID_OUTCOMES: TurnOutcome[] = ["success", "miss", "invalid"];

export function validateSetupMatch(body: unknown): ValidationResult {
  const errors: string[] = [];

  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }

  const req = body as SetupMatchRequest;

  if (!VALID_TEAMS.includes(req.firstThrowingTeam)) {
    errors.push(`firstThrowingTeam must be one of: ${VALID_TEAMS.join(", ")}`);
  }

  if (typeof req.turnDurationSec !== "number" || Number.isNaN(req.turnDurationSec)) {
    errors.push("turnDurationSec must be a valid number");
  } else if (req.turnDurationSec <= 0 || req.turnDurationSec > 60) {
    errors.push("turnDurationSec must be between 1 and 60");
  }

  for (const team of VALID_TEAMS) {
    const teamConfig = req.teams?.[team];
    if (!teamConfig || typeof teamConfig !== "object") {
      errors.push(`${team} team config is required`);
      continue;
    }

    if (typeof teamConfig.name !== "string" || teamConfig.name.trim() === "") {
      errors.push(`${team} team name is required`);
    }

    if (!Array.isArray(teamConfig.players) || teamConfig.players.length === 0) {
      errors.push(`${team} team must have at least one player`);
      continue;
    }

    teamConfig.players.forEach((player, index) => {
      if (typeof player.name !== "string" || player.name.trim() === "") {
        errors.push(`${team} player ${index + 1} name is required`);
      }
      if (typeof player.basePoints !== "number" || Number.isNaN(player.basePoints)) {
        errors.push(`${team} player ${index + 1} basePoints must be a valid number`);
      } else if (player.basePoints < 0) {
        errors.push(`${team} player ${index + 1} basePoints must be >= 0`);
      }
    });
  }

  const redCount = req.teams?.red?.players?.length ?? -1;
  const blueCount = req.teams?.blue?.players?.length ?? -1;
  if (redCount !== blueCount) {
    errors.push("red and blue teams must have the same number of players");
  }

  if (!Array.isArray(req.balls) || req.balls.length < 3) {
    errors.push("balls must contain at least 3 entries");
  } else {
    req.balls.forEach((ball, index) => {
      if (typeof ball.name !== "string" || ball.name.trim() === "") {
        errors.push(`ball ${index + 1} name is required`);
      }
      if (!ball.initialCount || typeof ball.initialCount !== "object") {
        errors.push(`ball ${index + 1} initialCount is required`);
        return;
      }

      for (const team of VALID_TEAMS) {
        const value = ball.initialCount[team];
        if (typeof value !== "number" || Number.isNaN(value)) {
          errors.push(`ball ${index + 1} ${team} initialCount must be a valid number`);
        } else if (!Number.isInteger(value) || value < 1 || value > 2) {
          errors.push(`ball ${index + 1} ${team} initialCount must be 1 or 2`);
        }
      }
    });
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateSensorValue(body: unknown): ValidationResult {
  const errors: string[] = [];

  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }

  const req = body as SensorValueRequest;
  if (typeof req.raw !== "number" || Number.isNaN(req.raw)) {
    errors.push("raw must be a valid number");
  }
  if (req.timestamp !== undefined && (typeof req.timestamp !== "number" || Number.isNaN(req.timestamp))) {
    errors.push("timestamp must be a valid number if provided");
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateMeshButton(body: unknown): ValidationResult {
  const errors: string[] = [];

  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }

  const req = body as MeshButtonRequest;
  if (typeof req.buttonId !== "string" || req.buttonId.trim() === "") {
    errors.push("buttonId is required");
  }
  if (typeof req.action !== "string" || req.action.trim() === "") {
    errors.push("action is required");
  }
  if (req.timestamp !== undefined && (typeof req.timestamp !== "number" || Number.isNaN(req.timestamp))) {
    errors.push("timestamp must be a valid number if provided");
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateSelectShooter(body: unknown): ValidationResult {
  const errors: string[] = [];
  const req = body as SelectShooterRequest;

  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }
  if (typeof req.playerId !== "string" || req.playerId.trim() === "") {
    errors.push("playerId is required");
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateSelectDistance(body: unknown): ValidationResult {
  const errors: string[] = [];
  const req = body as SelectDistanceRequest;

  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }
  if (!VALID_DISTANCES.includes(req.distanceId)) {
    errors.push(`distanceId must be one of: ${VALID_DISTANCES.join(", ")}`);
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateSelectBall(body: unknown): ValidationResult {
  const errors: string[] = [];
  const req = body as SelectBallRequest;

  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }
  if (typeof req.ballId !== "string" || req.ballId.trim() === "") {
    errors.push("ballId is required");
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateSelectBonus(body: unknown): ValidationResult {
  const errors: string[] = [];
  const req = body as SelectBonusRequest;

  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }
  if (!VALID_BONUS_CHOICES.includes(req.bonusChoice)) {
    errors.push(`bonusChoice must be one of: ${VALID_BONUS_CHOICES.join(", ")}`);
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateResolveTurn(body: unknown): ValidationResult {
  const errors: string[] = [];
  const req = body as ResolveTurnRequest;

  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }
  if (!VALID_OUTCOMES.includes(req.outcome)) {
    errors.push(`outcome must be one of: ${VALID_OUTCOMES.join(", ")}`);
  }
  if (req.foulTeam !== undefined && req.foulTeam !== null && !VALID_TEAMS.includes(req.foulTeam)) {
    errors.push(`foulTeam must be one of: ${VALID_TEAMS.join(", ")}`);
  }
  if (
    req.disqualifiedTeam !== undefined &&
    req.disqualifiedTeam !== null &&
    !VALID_TEAMS.includes(req.disqualifiedTeam)
  ) {
    errors.push(`disqualifiedTeam must be one of: ${VALID_TEAMS.join(", ")}`);
  }
  if (
    req.actualDistanceId !== undefined &&
    req.actualDistanceId !== null &&
    !VALID_DISTANCES.includes(req.actualDistanceId)
  ) {
    errors.push(`actualDistanceId must be one of: ${VALID_DISTANCES.join(", ")}`);
  }
  if (req.notes !== undefined && req.notes !== null && typeof req.notes !== "string") {
    errors.push("notes must be a string if provided");
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateAdjustFoul(body: unknown): ValidationResult {
  const errors: string[] = [];
  const req = body as AdjustFoulRequest;

  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }
  if (!VALID_TEAMS.includes(req.team)) {
    errors.push(`team must be one of: ${VALID_TEAMS.join(", ")}`);
  }
  if (typeof req.delta !== "number" || ![-1, 1].includes(req.delta)) {
    errors.push("delta must be 1 or -1");
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateAdjustBall(body: unknown): ValidationResult {
  const errors: string[] = [];
  const req = body as AdjustBallRequest;

  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }
  if (!VALID_TEAMS.includes(req.team)) {
    errors.push(`team must be one of: ${VALID_TEAMS.join(", ")}`);
  }
  if (typeof req.ballId !== "string" || req.ballId.trim() === "") {
    errors.push("ballId is required");
  }
  if (typeof req.delta !== "number" || ![-1, 1].includes(req.delta)) {
    errors.push("delta must be 1 or -1");
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateCalibration(body: unknown): ValidationResult {
  const errors: string[] = [];
  const req = body as CalibrationRequest;

  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }
  if (typeof req.minRaw !== "number" || Number.isNaN(req.minRaw)) {
    errors.push("minRaw must be a valid number");
  }
  if (typeof req.emptyRaw !== "number" || Number.isNaN(req.emptyRaw)) {
    errors.push("emptyRaw must be a valid number");
  }
  if (typeof req.triggerThreshold !== "number" || Number.isNaN(req.triggerThreshold)) {
    errors.push("triggerThreshold must be a valid number");
  } else if (req.triggerThreshold < 0 || req.triggerThreshold > 100) {
    errors.push("triggerThreshold must be between 0 and 100");
  }
  if (
    typeof req.minRaw === "number" &&
    typeof req.emptyRaw === "number" &&
    req.minRaw === req.emptyRaw
  ) {
    errors.push("minRaw and emptyRaw must be different");
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateStartMatch(body: unknown): ValidationResult {
  const errors: string[] = [];
  if (body === undefined || body === null) {
    return { valid: true };
  }
  if (typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }
  const req = body as StartMatchRequest;
  if (req.firstThrowingTeam !== undefined && !VALID_TEAMS.includes(req.firstThrowingTeam)) {
    errors.push(`firstThrowingTeam must be one of: ${VALID_TEAMS.join(", ")}`);
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateStartOvertime(body: unknown): ValidationResult {
  const errors: string[] = [];
  if (body === undefined || body === null) {
    return { valid: true };
  }
  if (typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }
  const req = body as StartOvertimeRequest;
  if (req.firstThrowingTeam !== undefined && !VALID_TEAMS.includes(req.firstThrowingTeam)) {
    errors.push(`firstThrowingTeam must be one of: ${VALID_TEAMS.join(", ")}`);
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}
