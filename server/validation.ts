import {
  AdjustFoulRequest,
  BonusChoice,
  CalibrationRequest,
  MeshButtonRequest,
  ResolveTurnRequest,
  SelectBonusRequest,
  SelectDistanceRequest,
  SensorValueRequest,
  SetDraftOrderRequest,
  SetupMatchRequest,
  StartMatchRequest,
  StartOvertimeRequest,
  Team,
  TurnOutcome,
} from "./types";
import {
  DISTANCE_MAX_METER,
  DISTANCE_MIN_METER,
  getExpectedTotalBasePoints,
  isValidDistanceMeter,
} from "./scoring";

interface ValidationError {
  valid: false;
  errors: string[];
}

interface ValidationSuccess {
  valid: true;
}

type ValidationResult = ValidationError | ValidationSuccess;

const VALID_TEAMS: Team[] = ["red", "blue"];
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

    let totalBasePoints = 0;
    let hasInvalidBasePoints = false;

    teamConfig.players.forEach((player, index) => {
      if (typeof player.name !== "string" || player.name.trim() === "") {
        errors.push(`${team} player ${index + 1} name is required`);
      }
      if (typeof player.basePoints !== "number" || Number.isNaN(player.basePoints)) {
        errors.push(`${team} player ${index + 1} basePoints must be a valid number`);
        hasInvalidBasePoints = true;
      } else if (!Number.isInteger(player.basePoints) || player.basePoints < 1) {
        errors.push(`${team} player ${index + 1} basePoints must be an integer >= 1`);
        hasInvalidBasePoints = true;
      } else {
        totalBasePoints += player.basePoints;
      }
    });

    if (!hasInvalidBasePoints) {
      const expectedTotalBasePoints = getExpectedTotalBasePoints(teamConfig.players.length);
      if (totalBasePoints !== expectedTotalBasePoints) {
        errors.push(
          `${team} team total basePoints must equal ${expectedTotalBasePoints} (current ${totalBasePoints})`
        );
      }
    }
  }

  const redCount = req.teams?.red?.players?.length ?? -1;
  const blueCount = req.teams?.blue?.players?.length ?? -1;
  if (redCount !== blueCount) {
    errors.push("red and blue teams must have the same number of players");
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateSetDraftOrder(body: unknown): ValidationResult {
  const errors: string[] = [];

  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }

  const req = body as SetDraftOrderRequest;

  if (!VALID_TEAMS.includes(req.team)) {
    errors.push(`team must be one of: ${VALID_TEAMS.join(", ")}`);
  }

  if (!Array.isArray(req.playerIds)) {
    errors.push("playerIds must be an array");
  } else if (!req.playerIds.every((value) => typeof value === "string" && value.trim() !== "")) {
    errors.push("playerIds must contain non-empty strings");
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

export function validateSelectDistance(body: unknown): ValidationResult {
  const errors: string[] = [];
  const req = body as SelectDistanceRequest;

  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }
  if (!isValidDistanceMeter(req.distanceId)) {
    errors.push(`distanceId must be an integer between ${DISTANCE_MIN_METER} and ${DISTANCE_MAX_METER}`);
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
    !isValidDistanceMeter(req.actualDistanceId)
  ) {
    errors.push(
      `actualDistanceId must be an integer between ${DISTANCE_MIN_METER} and ${DISTANCE_MAX_METER}`
    );
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
    req.emptyRaw < req.minRaw
  ) {
    errors.push("emptyRaw must be greater than or equal to minRaw");
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateStartMatch(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }
  const errors: string[] = [];
  const req = body as StartMatchRequest;

  if (req.firstThrowingTeam !== undefined && !VALID_TEAMS.includes(req.firstThrowingTeam)) {
    errors.push(`firstThrowingTeam must be one of: ${VALID_TEAMS.join(", ")}`);
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateStartOvertime(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") {
    return { valid: false, errors: ["Request body must be an object"] };
  }
  const errors: string[] = [];
  const req = body as StartOvertimeRequest;

  if (req.firstThrowingTeam !== undefined && !VALID_TEAMS.includes(req.firstThrowingTeam)) {
    errors.push(`firstThrowingTeam must be one of: ${VALID_TEAMS.join(", ")}`);
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}
