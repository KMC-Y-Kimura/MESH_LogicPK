import {
  BallState,
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
import { calculateAverageBasePoints, getExpectedTotalBasePoints } from "./scoring";
import { defaultCalibration, loadCalibration } from "./config";

const SETUP_DURATION_OPTIONS = [10, 15, 20, 30, 45, 60];
const THRESHOLD_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 50];

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
    const baseState: MatchState = {
      phase: "setup",
      turnDurationSec: 30,
      firstThrowingTeam: "red",
      roundNumber: 1,
      teams: {
        red: this.createTeamState("RED", "red", [
          { name: "R1", basePoints: 0 },
          { name: "R2", basePoints: 0 },
          { name: "R3", basePoints: 0 },
        ]),
        blue: this.createTeamState("BLUE", "blue", [
          { name: "B1", basePoints: 0 },
          { name: "B2", basePoints: 0 },
          { name: "B3", basePoints: 0 },
        ]),
      },
      balls: [
        {
          id: "ball-1",
          name: "ボールA",
          initialCount: { red: 1, blue: 1 },
          remaining: { red: 1, blue: 1 },
        },
        {
          id: "ball-2",
          name: "ボールB",
          initialCount: { red: 1, blue: 1 },
          remaining: { red: 1, blue: 1 },
        },
        {
          id: "ball-3",
          name: "ボールC",
          initialCount: { red: 1, blue: 1 },
          remaining: { red: 1, blue: 1 },
        },
      ],
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

    return baseState;
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
      focus: "duration",
      durationOptions: [...SETUP_DURATION_OPTIONS],
      thresholdOptions: [...THRESHOLD_OPTIONS],
    };
  }

  private createTeamControlState(team: Team): TeamControlState {
    return {
      team,
      mode: "idle",
      candidatePlayerId: null,
      candidateDistanceId: null,
      candidateBallId: null,
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
      totalBasePoints,
      averageBasePoints: calculateAverageBasePoints(totalBasePoints, normalizedPlayers.length),
      rawScore: 0,
      fouls: 0,
      disqualified: false,
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

  private createTurn(turnNumber: number, roundNumber: number, throwingTeam: Team): TurnState {
    return {
      roundNumber,
      turnNumber,
      throwingTeam,
      defendingTeam: otherTeam(throwingTeam),
      selection: {
        shooterId: null,
        distanceId: null,
        ballId: null,
        bonusChoice: null,
      },
      startedAt: null,
      reviewStartedAt: null,
      sensorTriggeredAt: null,
      outcome: null,
      actualDistanceId: null,
      foulTeam: null,
      disqualifiedTeam: null,
      scoreBreakdown: null,
      notes: null,
    };
  }

  private getAvailableThrowerIds(team: Team): string[] {
    return this.state.teams[team].players
      .filter((player) => !player.hasActedInRound)
      .map((player) => player.id);
  }

  private getAvailableBallIds(team: Team): string[] {
    return this.state.balls.filter((ball) => ball.remaining[team] > 0).map((ball) => ball.id);
  }

  private getValidDurationCandidate(value: number): number {
    if (SETUP_DURATION_OPTIONS.includes(value)) {
      return value;
    }

    return SETUP_DURATION_OPTIONS[0];
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
    this.state = { ...this.state, ...partial };
  }

  setPhase(phase: MatchPhase): void {
    this.state.phase = phase;
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

  setTurnDurationSec(durationSec: number): void {
    this.state.turnDurationSec = durationSec;
  }

  setRoundNumber(roundNumber: number): void {
    this.state.roundNumber = roundNumber;
  }

  setFirstThrowingTeam(team: Team): void {
    this.state.firstThrowingTeam = team;
  }

  applySetup(request: SetupMatchRequest): void {
    const calibration = this.state.sensor.calibration;
    this.state = {
      phase: "setup",
      turnDurationSec: request.turnDurationSec,
      firstThrowingTeam: request.firstThrowingTeam,
      roundNumber: 1,
      teams: {
        red: this.createTeamState(request.teams.red.name, "red", request.teams.red.players),
        blue: this.createTeamState(request.teams.blue.name, "blue", request.teams.blue.players),
      },
      balls: request.balls.map((ball, index) => ({
        id: `ball-${index + 1}`,
        name: ball.name,
        initialCount: clone(ball.initialCount),
        remaining: clone(ball.initialCount),
      })),
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
    this.state.currentTurn = null;
    this.state.history = [];
    this.state.startedAt = null;
    this.state.finishedAt = null;
    this.state.winner = null;
    this.state.winnerReason = null;
    this.state.requiresOvertime = false;
    this.state.roundNumber = 1;
    this.state.sensor.successDetected = false;
    this.state.sensor.lastTriggeredAt = null;
    this.resetScoresAndRoundFlags();
    this.resetBallsToInitial();
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

  resetBallsToInitial(): void {
    this.state.balls = this.state.balls.map((ball) => ({
      ...ball,
      remaining: clone(ball.initialCount),
    }));
  }

  createInitialTurn(): TurnState {
    return this.createTurn(1, this.state.roundNumber, this.state.firstThrowingTeam);
  }

  createTurnFor(throwingTeam: Team, turnNumber: number, roundNumber = this.state.roundNumber): TurnState {
    return this.createTurn(turnNumber, roundNumber, throwingTeam);
  }

  createNextTurn(): TurnState {
    const previousTurn = this.state.currentTurn;
    const nextTurnNumber = (previousTurn?.turnNumber ?? this.state.history.length) + 1;
    const nextThrowingTeam = previousTurn ? otherTeam(previousTurn.throwingTeam) : this.state.firstThrowingTeam;
    return this.createTurn(nextTurnNumber, this.state.roundNumber, nextThrowingTeam);
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

  getBall(ballId: string): BallState | null {
    return this.state.balls.find((ball) => ball.id === ballId) ?? null;
  }

  consumeBall(team: Team, ballId: string): boolean {
    const ball = this.getBall(ballId);
    if (!ball || ball.remaining[team] <= 0) {
      return false;
    }

    this.state.balls = this.state.balls.map((entry) =>
      entry.id === ballId
        ? {
            ...entry,
            remaining: {
              ...entry.remaining,
              [team]: entry.remaining[team] - 1,
            },
          }
        : entry
    );
    return true;
  }

  adjustBall(team: Team, ballId: string, delta: number): BallState | null {
    const ball = this.getBall(ballId);
    if (!ball) {
      return null;
    }

    const updated = {
      ...ball,
      remaining: {
        ...ball.remaining,
        [team]: Math.max(0, ball.remaining[team] + delta),
      },
    };
    this.state.balls = this.state.balls.map((entry) => (entry.id === ballId ? updated : entry));
    return updated;
  }

  getRemainingBonusRights(recipientTeam: Team, roundNumber = this.state.roundNumber): number {
    const limit = this.state.teams[recipientTeam].players.length;
    let used = 0;

    for (const turn of this.state.history) {
      if (turn.roundNumber !== roundNumber) {
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
    if (this.getRemainingBonusRights(turn.throwingTeam, turn.roundNumber) > 0) {
      choices.push("distance");
    }
    if (this.getRemainingBonusRights(turn.defendingTeam, turn.roundNumber) > 0) {
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
        focus: currentSetup?.focus ?? "duration",
      },
      team: {
        red: this.createTeamControlState("red"),
        blue: this.createTeamControlState("blue"),
      },
      review: this.createReviewControlState(),
      lastInput: this.state.buttonControls.lastInput,
    };
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
    const availableThrowers = this.getAvailableThrowerIds(throwingTeam);
    const availableBalls = this.getAvailableBallIds(defendingTeam);

    const selectedShooter =
      turn.selection.shooterId && availableThrowers.includes(turn.selection.shooterId)
        ? turn.selection.shooterId
        : availableThrowers[0] ?? null;
    const selectedBall =
      turn.selection.ballId && availableBalls.includes(turn.selection.ballId)
        ? turn.selection.ballId
        : availableBalls[0] ?? null;
    const availableBonusChoices = this.getAvailableBonusChoices(turn);
    const selectedBonusChoice =
      turn.selection.bonusChoice && availableBonusChoices.includes(turn.selection.bonusChoice)
        ? turn.selection.bonusChoice
        : availableBonusChoices[0] ?? null;

    this.state.buttonControls.team[throwingTeam] = {
      team: throwingTeam,
      mode: turn.selection.shooterId
        ? turn.selection.distanceId
          ? "done"
          : "distance"
        : "shooter",
      candidatePlayerId: selectedShooter,
      candidateDistanceId:
        turn.selection.distanceId ??
        this.state.buttonControls.team[throwingTeam].candidateDistanceId ??
        "near",
      candidateBallId: selectedBall,
      candidateBonusChoice:
        selectedBonusChoice ??
        this.state.buttonControls.team[throwingTeam].candidateBonusChoice ??
        "distance",
    };

    this.state.buttonControls.team[defendingTeam] = {
      team: defendingTeam,
      mode: turn.selection.ballId
        ? selectedBonusChoice
          ? "done"
          : "bonus"
        : "ball",
      candidatePlayerId: selectedShooter,
      candidateDistanceId:
        turn.selection.distanceId ??
        this.state.buttonControls.team[defendingTeam].candidateDistanceId ??
        "near",
      candidateBallId: selectedBall,
      candidateBonusChoice:
        selectedBonusChoice ??
        this.state.buttonControls.team[defendingTeam].candidateBonusChoice ??
        availableBonusChoices[0] ??
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
      "duration",
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
    this.state.turnDurationSec = this.getValidDurationCandidate(this.state.turnDurationSec);
    this.state.sensor.calibration.triggerThreshold = this.getValidThresholdCandidate(
      this.state.sensor.calibration.triggerThreshold
    );
  }
}

export const matchStateManager = new MatchStateManager();
