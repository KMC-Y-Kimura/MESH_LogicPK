export type Team = "red" | "blue";
export type MatchPhase =
  | "setup"
  | "draft"
  | "selectionReady"
  | "selection"
  | "confirmation"
  | "active"
  | "review"
  | "result"
  | "finished";
export type DistanceMeter = number;
export type DistanceId = DistanceMeter;
export type BonusChoice = "distance" | "opponentAverage";
export type TurnOutcome = "success" | "miss" | "invalid";
export type Winner = Team | "draw" | null;
export type WinnerReason = "roundedScore" | "rawScore" | "fouls" | "disqualification" | null;
export type SetupControlFocus =
  | "firstThrowingTeam"
  | "triggerThreshold"
  | "autoCalibration"
  | "startMatch"
  | "reset";
export type TeamControlMode = "idle" | "order" | "distance" | "bonus" | "done";
export type ReviewControlFocus =
  | "outcome"
  | "actualDistance"
  | "foulTeam"
  | "disqualifiedTeam"
  | "confirm";

export interface Calibration {
  minRaw: number;
  emptyRaw: number;
  triggerThreshold: number;
}

export interface PlayerState {
  id: string;
  name: string;
  basePoints: number;
  hasActedInRound: boolean;
}

export interface TeamState {
  name: string;
  players: PlayerState[];
  throwOrderPlayerIds: string[];
  totalBasePoints: number;
  averageBasePoints: number;
  rawScore: number;
  fouls: number;
  disqualified: boolean;
}

export interface GoalSensorState {
  latestRaw: number | null;
  latestNormalized: number | null;
  lastTriggeredAt: number | null;
  successDetected: boolean;
  calibration: Calibration;
}

export interface TurnSelection {
  shooterId: string | null;
  distanceId: DistanceMeter | null;
  bonusChoice: BonusChoice | null;
}

export interface TurnScoreBreakdown {
  shooterBasePoints: number;
  distancePoints: number;
  opponentAveragePoints: number;
  redDelta: number;
  blueDelta: number;
}

export interface TurnState {
  turnNumber: number;
  isOvertime: boolean;
  throwingTeam: Team;
  defendingTeam: Team;
  selection: TurnSelection;
  startedAt: number | null;
  reviewStartedAt: number | null;
  resolvedAt: number | null;
  sensorTriggeredAt: number | null;
  outcome: TurnOutcome | null;
  actualDistanceId: DistanceMeter | null;
  foulTeam: Team | null;
  disqualifiedTeam: Team | null;
  scoreBreakdown: TurnScoreBreakdown | null;
  notes: string | null;
}

export interface SetupControlState {
  focus: SetupControlFocus;
  thresholdOptions: number[];
}

export interface TeamControlState {
  team: Team;
  mode: TeamControlMode;
  candidatePlayerId: string | null;
  candidateDistanceId: DistanceMeter | null;
  candidateBonusChoice: BonusChoice | null;
}

export interface ReviewControlState {
  focus: ReviewControlFocus;
  outcome: TurnOutcome;
  actualDistanceId: DistanceMeter | null;
  foulTeam: Team | null;
  disqualifiedTeam: Team | null;
  notes: string | null;
}

export interface LastButtonInputState {
  buttonId: string;
  action: string;
  timestamp: number;
  handled: boolean;
  summary: string;
}

export interface ButtonControlsState {
  setup: SetupControlState;
  team: Record<Team, TeamControlState>;
  review: ReviewControlState;
  lastInput: LastButtonInputState | null;
}

export interface MatchState {
  phase: MatchPhase;
  phaseStartedAt: number | null;
  draftDurationSec: number;
  selectionDurationSec: number;
  activeDurationSec: number;
  firstThrowingTeam: Team;
  isOvertime: boolean;
  teams: Record<Team, TeamState>;
  sensor: GoalSensorState;
  currentTurn: TurnState | null;
  history: TurnState[];
  startedAt: number | null;
  finishedAt: number | null;
  winner: Winner;
  winnerReason: WinnerReason;
  requiresOvertime: boolean;
  buttonControls: ButtonControlsState;
}

export interface EventLogEntry {
  type: string;
  message: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

export interface SetupPlayerInput {
  name: string;
  basePoints: number;
}

export interface SetupTeamInput {
  name: string;
  players: SetupPlayerInput[];
}

export interface SetupMatchRequest {
  teams: Record<Team, SetupTeamInput>;
  firstThrowingTeam: Team;
}

export interface SetDraftOrderRequest {
  team: Team;
  playerIds: string[];
}

export interface ResolveTurnRequest {
  outcome: TurnOutcome;
  foulTeam?: Team | null;
  disqualifiedTeam?: Team | null;
  actualDistanceId?: DistanceMeter | null;
  notes?: string | null;
}

export interface RealtimeEvent {
  type: "stateUpdate" | "sensorValue" | "eventLog";
  payload: unknown;
  timestamp: number;
}
