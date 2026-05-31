import {
  BonusChoice,
  ButtonControlsState,
  Calibration,
  EventLogEntry,
  GoalSensorState,
  LastButtonInputState,
  MatchPhase,
  MatchState,
  PlayerState,
  ReviewControlState,
  SetupControlFocus,
  SetupControlState,
  SetupMatchRequest,
  Team,
  TeamControlState,
  TeamState,
  TurnSelection,
  TurnState,
  Winner,
  WinnerReason,
} from "./types";
import {
  calculateAverageBasePoints,
  DISTANCE_OPTIONS,
  getExpectedTotalBasePoints,
} from "./scoring";
import { defaultCalibration, loadCalibration } from "./config";

const THRESHOLD_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 50];
const FIXED_DRAFT_DURATION_SEC = 300;
const FIXED_SELECTION_DURATION_SEC = 10;
const FIXED_ACTIVE_DURATION_SEC = 20;

function otherTeam(team: Team): Team {
  return team === "red" ? "blue" : "red";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export class MatchStateManager {
  private state: MatchState;
  private eventLog: EventLogEntry[] = [];

  constructor() {
    this.state = this.initializeState();
  }

  private initializeState(): MatchState {
    const calibration = loadCalibration();

    return {
      phase: "setup",
      phaseStartedAt: null,
      draftDurationSec: FIXED_DRAFT_DURATION_SEC,
      selectionDurationSec: FIXED_SELECTION_DURATION_SEC,
      activeDurationSec: FIXED_ACTIVE_DURATION_SEC,
      firstThrowingTeam: "red",
      isOvertime: false,
      teams: {
        red: this.createTeamState("RED", "red", [
          { name: "R1", basePoints: 3 },
          { name: "R2", basePoints: 3 },
          { name: "R3", basePoints: 2 },
        ]),
        blue: this.createTeamState("BLUE", "blue", [
          { name: "B1", basePoints: 3 },
          { name: "B2", basePoints: 3 },
          { name: "B3", basePoints: 2 },
        ]),
      },
      sensor: this.createSensorState(calibration),
      currentTurn: null,
      history: [],
      startedAt: null,
      finishedAt: null,
      winner: null,
      winnerReason: null,
      requiresOvertime: false,
      buttonControls: this.createButtonControls(),
    };
  }

  private createSensorState(calibration: Calibration): GoalSensorState {
    return {
      latestRaw: null,
      latestNormalized: null,
      lastTriggeredAt: null,
      successDetected: false,
      calibration: clone(calibration ?? defaultCalibration),
    };
  }

  private createSetupControlState(): SetupControlState {
    return {
      focus: "firstThrowingTeam",
      thresholdOptions: [...THRESHOLD_OPTIONS],
    };
  }

  private createTeamControlState(team: Team): TeamControlState {
    return {
      team,
      mode: "idle",
      candidatePlayerId: null,
      candidateDistanceId: DISTANCE_OPTIONS[0] ?? null,
      candidateBonusChoice: null,
    };
  }

  private createReviewControlState(): ReviewControlState {
    return {
      focus: "outcome",
      outcome: "miss",
      actualDistanceId: null,
      foulTeam: null,
      disqualifiedTeam: null,
      notes: null,
    };
  }

  private createButtonControls(): ButtonControlsState {
    return {
      setup: this.createSetupControlState(),
      team: {
        red: this.createTeamControlState("red"),
        blue: this.createTeamControlState("blue"),
      },
      review: this.createReviewControlState(),
      lastInput: null,
    };
  }

  private createPlayer(
    team: Team,
    index: number,
    player: { name: string; basePoints: number }
  ): PlayerState {
    return {
      id: `${team}-player-${index + 1}`,
      name: player.name,
      basePoints: player.basePoints,
      hasActedInRound: false,
    };
  }

  private createTeamState(
    name: string,
    team: Team,
    players: Array<{ name: string; basePoints: number }>
  ): TeamState {
    const normalizedPlayers = players.map((player, index) => this.createPlayer(team, index, player));
    const totalBasePoints = normalizedPlayers.reduce((sum, player) => sum + player.basePoints, 0);

    return {
      name,
      players: normalizedPlayers,
      throwOrderPlayerIds: [],
      totalBasePoints,
      averageBasePoints: calculateAverageBasePoints(totalBasePoints, normalizedPlayers.length),
      rawScore: 0,
      fouls: 0,
      disqualified: false,
    };
  }

  private createTurn(
    turnNumber: number,
    isOvertime: boolean,
    throwingTeam: Team,
    shooterId: string | null
  ): TurnState {
    return {
      turnNumber,
      isOvertime,
      throwingTeam,
      defendingTeam: otherTeam(throwingTeam),
      selection: {
        shooterId,
        distanceId: null,
        bonusChoice: null,
      },
      startedAt: null,
      reviewStartedAt: null,
      resolvedAt: null,
      sensorTriggeredAt: null,
      outcome: null,
      actualDistanceId: null,
      foulTeam: null,
      disqualifiedTeam: null,
      scoreBreakdown: null,
      notes: null,
    };
  }

  private getValidThresholdCandidate(value: number): number {
    if (THRESHOLD_OPTIONS.includes(value)) {
      return value;
    }

    return THRESHOLD_OPTIONS[0];
  }

  getState(): MatchState {
    return clone(this.state);
  }

  setState(partial: Partial<MatchState>): void {
    this.state = {
      ...this.state,
      ...clone(partial),
    };
  }

  setPhase(phase: MatchPhase, phaseStartedAt: number | null): void {
    this.state.phase = phase;
    this.state.phaseStartedAt = phaseStartedAt;
  }

  setWinner(winner: Winner, reason: WinnerReason): void {
    this.state.winner = winner;
    this.state.winnerReason = reason;
  }

  setRequiresOvertime(value: boolean): void {
    this.state.requiresOvertime = value;
  }

  setStartedAt(timestamp: number | null): void {
    this.state.startedAt = timestamp;
  }

  setFinishedAt(timestamp: number | null): void {
    this.state.finishedAt = timestamp;
  }

  setIsOvertime(isOvertime: boolean): void {
    this.state.isOvertime = isOvertime;
  }

  setFirstThrowingTeam(team: Team): void {
    this.state.firstThrowingTeam = team;
  }

  applySetup(request: SetupMatchRequest): void {
    const calibration = this.state.sensor.calibration;
    this.state = {
      phase: "setup",
      phaseStartedAt: null,
      draftDurationSec: FIXED_DRAFT_DURATION_SEC,
      selectionDurationSec: FIXED_SELECTION_DURATION_SEC,
      activeDurationSec: FIXED_ACTIVE_DURATION_SEC,
      firstThrowingTeam: request.firstThrowingTeam,
      isOvertime: false,
      teams: {
        red: this.createTeamState(request.teams.red.name, "red", request.teams.red.players),
        blue: this.createTeamState(request.teams.blue.name, "blue", request.teams.blue.players),
      },
      sensor: this.createSensorState(calibration),
      currentTurn: null,
      history: [],
      startedAt: null,
      finishedAt: null,
      winner: null,
      winnerReason: null,
      requiresOvertime: false,
      buttonControls: this.createButtonControls(),
    };
    this.eventLog = [];
  }

  resetToSetup(): void {
    this.state.phase = "setup";
    this.state.phaseStartedAt = null;
    this.state.currentTurn = null;
    this.state.history = [];
    this.state.startedAt = null;
    this.state.finishedAt = null;
    this.state.winner = null;
    this.state.winnerReason = null;
    this.state.requiresOvertime = false;
    this.state.isOvertime = false;
    this.state.sensor.successDetected = false;
    this.state.sensor.lastTriggeredAt = null;
    this.resetScoresAndRoundFlags();
    this.clearThrowOrders();
    this.resetButtonControlsForSetup();
  }

  resetScoresAndRoundFlags(): void {
    (["red", "blue"] as Team[]).forEach((team) => {
      const teamState = this.state.teams[team];
      teamState.rawScore = 0;
      teamState.fouls = 0;
      teamState.disqualified = false;
      teamState.players = teamState.players.map((player) => ({
        ...player,
        hasActedInRound: false,
      }));
    });
  }

  resetRoundFlagsOnly(): void {
    (["red", "blue"] as Team[]).forEach((team) => {
      this.state.teams[team].players = this.state.teams[team].players.map((player) => ({
        ...player,
        hasActedInRound: false,
      }));
    });
  }

  clearThrowOrders(): void {
    (["red", "blue"] as Team[]).forEach((team) => {
      this.state.teams[team].throwOrderPlayerIds = [];
    });
  }

  getTeam(team: Team): TeamState {
    return this.state.teams[team];
  }

  updateTeam(team: Team, updates: Partial<TeamState>): void {
    this.state.teams[team] = {
      ...this.state.teams[team],
      ...clone(updates),
    };
  }

  getPlayer(team: Team, playerId: string): PlayerState | null {
    return this.state.teams[team].players.find((player) => player.id === playerId) ?? null;
  }

  markPlayerActed(team: Team, playerId: string): void {
    this.state.teams[team].players = this.state.teams[team].players.map((player) =>
      player.id === playerId ? { ...player, hasActedInRound: true } : player
    );
  }

  haveAllPlayersActedThisRound(): boolean {
    return (["red", "blue"] as Team[]).every((team) =>
      this.state.teams[team].players.every((player) => player.hasActedInRound)
    );
  }

  addScore(team: Team, delta: number): void {
    this.state.teams[team].rawScore += delta;
  }

  addFoul(team: Team, delta: number): void {
    this.state.teams[team].fouls = Math.max(0, this.state.teams[team].fouls + delta);
  }

  disqualifyTeam(team: Team): void {
    this.state.teams[team].disqualified = true;
  }

  getDraftOrder(team: Team): string[] {
    return [...this.state.teams[team].throwOrderPlayerIds];
  }

  setDraftOrder(team: Team, playerIds: string[]): void {
    this.state.teams[team].throwOrderPlayerIds = [...playerIds];
  }

  appendDraftOrder(team: Team, playerId: string): boolean {
    const teamState = this.state.teams[team];
    if (teamState.throwOrderPlayerIds.includes(playerId)) {
      return false;
    }
    if (!teamState.players.some((player) => player.id === playerId)) {
      return false;
    }
    teamState.throwOrderPlayerIds = [...teamState.throwOrderPlayerIds, playerId];
    return true;
  }

  getRemainingDraftPlayers(team: Team): PlayerState[] {
    const order = new Set(this.state.teams[team].throwOrderPlayerIds);
    return this.state.teams[team].players.filter((player) => !order.has(player.id));
  }

  isDraftComplete(): boolean {
    return (["red", "blue"] as Team[]).every(
      (team) => this.state.teams[team].throwOrderPlayerIds.length === this.state.teams[team].players.length
    );
  }

  autoCompleteDraftOrders(): void {
    (["red", "blue"] as Team[]).forEach((team) => {
      const teamState = this.state.teams[team];
      const used = new Set(teamState.throwOrderPlayerIds);
      const remaining = teamState.players.filter((player) => !used.has(player.id)).map((player) => player.id);
      if (remaining.length > 0) {
        teamState.throwOrderPlayerIds = [...teamState.throwOrderPlayerIds, ...remaining];
      }
    });
  }

  getNextShooterId(team: Team): string | null {
    const teamState = this.state.teams[team];
    for (const playerId of teamState.throwOrderPlayerIds) {
      const player = teamState.players.find((entry) => entry.id === playerId);
      if (player && !player.hasActedInRound) {
        return player.id;
      }
    }

    return teamState.players.find((player) => !player.hasActedInRound)?.id ?? null;
  }

  createInitialTurn(): TurnState {
    return this.createTurn(
      1,
      this.state.isOvertime,
      this.state.firstThrowingTeam,
      this.getNextShooterId(this.state.firstThrowingTeam)
    );
  }

  createTurnFor(throwingTeam: Team, turnNumber: number, isOvertime = this.state.isOvertime): TurnState {
    return this.createTurn(turnNumber, isOvertime, throwingTeam, this.getNextShooterId(throwingTeam));
  }

  createNextTurn(): TurnState {
    const previousTurn = this.state.currentTurn;
    const nextTurnNumber = (previousTurn?.turnNumber ?? this.state.history.length) + 1;
    const nextThrowingTeam = previousTurn ? otherTeam(previousTurn.throwingTeam) : this.state.firstThrowingTeam;
    return this.createTurn(nextTurnNumber, this.state.isOvertime, nextThrowingTeam, this.getNextShooterId(nextThrowingTeam));
  }

  setCurrentTurn(turn: TurnState | null): void {
    this.state.currentTurn = turn ? clone(turn) : null;
  }

  updateCurrentTurn(updates: Partial<TurnState>): void {
    if (!this.state.currentTurn) {
      return;
    }
    this.state.currentTurn = {
      ...this.state.currentTurn,
      ...clone(updates),
    };
  }

  updateCurrentSelection(updates: Partial<TurnSelection>): void {
    if (!this.state.currentTurn) {
      return;
    }
    this.state.currentTurn.selection = {
      ...this.state.currentTurn.selection,
      ...clone(updates),
    };
  }

  appendCurrentTurnToHistory(): void {
    if (!this.state.currentTurn) {
      return;
    }
    this.state.history.push(clone(this.state.currentTurn));
  }

  getRemainingBonusRights(recipientTeam: Team, isOvertime = this.state.isOvertime): number {
    const limit = this.state.teams[recipientTeam].players.length;
    let used = 0;

    for (const turn of this.state.history) {
      if (turn.isOvertime !== isOvertime) {
        continue;
      }
      if (turn.selection.bonusChoice === "distance" && turn.throwingTeam === recipientTeam) {
        used += 1;
      }
      if (turn.selection.bonusChoice === "opponentAverage" && turn.defendingTeam === recipientTeam) {
        used += 1;
      }
    }

    return Math.max(0, limit - used);
  }

  getAvailableBonusChoices(turn: TurnState | null = this.state.currentTurn): BonusChoice[] {
    if (!turn) {
      return [];
    }

    const choices: BonusChoice[] = [];
    if (this.getRemainingBonusRights(turn.throwingTeam, turn.isOvertime) > 0) {
      choices.push("distance");
    }
    if (this.getRemainingBonusRights(turn.defendingTeam, turn.isOvertime) > 0) {
      choices.push("opponentAverage");
    }
    return choices;
  }

  updateSensor(raw: number, normalized: number): void {
    this.state.sensor.latestRaw = raw;
    this.state.sensor.latestNormalized = normalized;
  }

  markSensorTriggered(timestamp: number): void {
    this.state.sensor.lastTriggeredAt = timestamp;
    this.state.sensor.successDetected = true;
    if (this.state.currentTurn) {
      this.state.currentTurn.sensorTriggeredAt = timestamp;
    }
  }

  clearSensorTriggeredState(): void {
    this.state.sensor.successDetected = false;
    this.state.sensor.lastTriggeredAt = null;
  }

  updateCalibration(calibration: Calibration): void {
    this.state.sensor.calibration = clone(calibration);
  }

  getCalibration(): Calibration {
    return clone(this.state.sensor.calibration);
  }

  getButtonControls(): ButtonControlsState {
    return clone(this.state.buttonControls);
  }

  setButtonControls(buttonControls: ButtonControlsState): void {
    this.state.buttonControls = clone(buttonControls);
  }

  updateSetupControl(updates: Partial<SetupControlState>): void {
    this.state.buttonControls.setup = {
      ...this.state.buttonControls.setup,
      ...clone(updates),
    };
  }

  updateTeamControl(team: Team, updates: Partial<TeamControlState>): void {
    this.state.buttonControls.team[team] = {
      ...this.state.buttonControls.team[team],
      ...clone(updates),
    };
  }

  updateReviewControl(updates: Partial<ReviewControlState>): void {
    this.state.buttonControls.review = {
      ...this.state.buttonControls.review,
      ...clone(updates),
    };
  }

  setLastButtonInput(lastInput: LastButtonInputState | null): void {
    this.state.buttonControls.lastInput = lastInput ? clone(lastInput) : null;
  }

  resetButtonControlsForSetup(): void {
    const currentSetup = this.state.buttonControls.setup;
    this.state.buttonControls = {
      setup: {
        ...this.createSetupControlState(),
        focus: currentSetup?.focus ?? "firstThrowingTeam",
      },
      team: {
        red: this.createTeamControlState("red"),
        blue: this.createTeamControlState("blue"),
      },
      review: this.createReviewControlState(),
      lastInput: this.state.buttonControls.lastInput,
    };
  }

  prepareDraftControls(): void {
    (["red", "blue"] as Team[]).forEach((team) => {
      const remainingPlayers = this.getRemainingDraftPlayers(team);
      const previousCandidate = this.state.buttonControls.team[team].candidatePlayerId;
      const nextCandidate =
        remainingPlayers.find((player) => player.id === previousCandidate)?.id ?? remainingPlayers[0]?.id ?? null;

      this.state.buttonControls.team[team] = {
        team,
        mode: remainingPlayers.length === 0 ? "done" : "order",
        candidatePlayerId: nextCandidate,
        candidateDistanceId: this.state.buttonControls.team[team].candidateDistanceId ?? DISTANCE_OPTIONS[0] ?? null,
        candidateBonusChoice: this.state.buttonControls.team[team].candidateBonusChoice ?? null,
      };
    });
  }

  prepareSelectionControls(): void {
    const turn = this.state.currentTurn;
    if (!turn) {
      this.state.buttonControls.team.red = this.createTeamControlState("red");
      this.state.buttonControls.team.blue = this.createTeamControlState("blue");
      return;
    }

    const throwingTeam = turn.throwingTeam;
    const defendingTeam = turn.defendingTeam;
    const availableBonusChoices = this.getAvailableBonusChoices(turn);
    const selectedBonusChoice =
      turn.selection.bonusChoice && availableBonusChoices.includes(turn.selection.bonusChoice)
        ? turn.selection.bonusChoice
        : availableBonusChoices[0] ?? null;

    this.state.buttonControls.team[throwingTeam] = {
      team: throwingTeam,
      mode: turn.selection.distanceId ? "done" : "distance",
      candidatePlayerId: turn.selection.shooterId,
      candidateDistanceId:
        turn.selection.distanceId ??
        this.state.buttonControls.team[throwingTeam].candidateDistanceId ??
        DISTANCE_OPTIONS[0] ??
        null,
      candidateBonusChoice: selectedBonusChoice,
    };

    this.state.buttonControls.team[defendingTeam] = {
      team: defendingTeam,
      mode: turn.selection.bonusChoice ? "done" : "bonus",
      candidatePlayerId: turn.selection.shooterId,
      candidateDistanceId:
        turn.selection.distanceId ??
        this.state.buttonControls.team[defendingTeam].candidateDistanceId ??
        DISTANCE_OPTIONS[0] ??
        null,
      candidateBonusChoice:
        selectedBonusChoice ??
        this.state.buttonControls.team[defendingTeam].candidateBonusChoice ??
        null,
    };
  }

  prepareReviewControls(): void {
    const currentTurn = this.state.currentTurn;
    this.state.buttonControls.review = {
      focus: "outcome",
      outcome: currentTurn?.sensorTriggeredAt ? "success" : "miss",
      actualDistanceId: currentTurn?.selection.distanceId ?? null,
      foulTeam: null,
      disqualifiedTeam: null,
      notes: currentTurn?.notes ?? null,
    };
    this.state.buttonControls.team.red.mode = "idle";
    this.state.buttonControls.team.blue.mode = "idle";
  }

  clearReviewControls(): void {
    this.state.buttonControls.review = this.createReviewControlState();
  }

  addEventLog(entry: EventLogEntry): void {
    this.eventLog.push(entry);
    if (this.eventLog.length > 100) {
      this.eventLog.shift();
    }
  }

  getEventLog(): EventLogEntry[] {
    return clone(this.eventLog);
  }

  getExpectedBasePointSummary(team: Team): { expected: number; actual: number } {
    const teamState = this.state.teams[team];
    return {
      expected: getExpectedTotalBasePoints(teamState.players.length),
      actual: teamState.totalBasePoints,
    };
  }

  ensureSetupFocusIsValid(fallback: SetupControlFocus): void {
    const focus = this.state.buttonControls.setup.focus;
    const validFocuses: SetupControlFocus[] = [
      "firstThrowingTeam",
      "triggerThreshold",
      "autoCalibration",
      "startMatch",
      "reset",
    ];
    if (!validFocuses.includes(focus)) {
      this.state.buttonControls.setup.focus = fallback;
    }
  }

  normalizeSetupCandidates(): void {
    this.state.sensor.calibration.triggerThreshold = this.getValidThresholdCandidate(
      this.state.sensor.calibration.triggerThreshold
    );
  }
}

export const matchStateManager = new MatchStateManager();
