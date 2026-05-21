import express, { Request, Response } from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import { defaultConfig, saveCalibration } from "./config";
import { matchStateManager } from "./state";
import { realtimeManager } from "./realtime";
import {
  calculateSuccessBreakdown,
  determineWinner,
  getExpectedTotalBasePoints,
  normalizeGoalSensor,
} from "./scoring";
import {
  validateAdjustBall,
  validateAdjustFoul,
  validateCalibration,
  validateMeshButton,
  validateResolveTurn,
  validateSelectBall,
  validateSelectBonus,
  validateSelectDistance,
  validateSelectShooter,
  validateSensorValue,
  validateSetupMatch,
  validateStartMatch,
  validateStartOvertime,
} from "./validation";
import {
  AdjustBallRequest,
  AdjustFoulRequest,
  CalibrationRequest,
  DistanceId,
  EventLogEntry,
  KnownButtonAction,
  KnownButtonId,
  ResolveTurnRequest,
  ReviewControlFocus,
  SelectBallRequest,
  SelectBonusRequest,
  SelectDistanceRequest,
  SelectShooterRequest,
  SensorValueRequest,
  SetupControlFocus,
  SetupMatchRequest,
  StartMatchRequest,
  StartOvertimeRequest,
  Team,
  TurnOutcome,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

let turnTimeoutId: NodeJS.Timeout | null = null;

function otherTeam(team: Team): Team {
  return team === "red" ? "blue" : "red";
}

function addEventLog(type: string, message: string, details?: Record<string, unknown>): void {
  const entry: EventLogEntry = {
    type,
    message,
    timestamp: Date.now(),
    details,
  };
  matchStateManager.addEventLog(entry);
  realtimeManager.broadcastEventLog(matchStateManager.getEventLog());
}

function broadcastState(): void {
  realtimeManager.broadcastStateUpdate(matchStateManager.getState());
}

function clearTurnTimeout(): void {
  if (turnTimeoutId) {
    clearTimeout(turnTimeoutId);
    turnTimeoutId = null;
  }
}

const SETUP_FOCUS_ORDER: SetupControlFocus[] = [
  "duration",
  "firstThrowingTeam",
  "triggerThreshold",
  "autoCalibration",
  "startMatch",
  "reset",
];
const REVIEW_FOCUS_ORDER: ReviewControlFocus[] = [
  "outcome",
  "actualDistance",
  "foulTeam",
  "disqualifiedTeam",
  "confirm",
];
const DISTANCE_ORDER: DistanceId[] = ["near", "middle", "far"];
const OUTCOME_ORDER: TurnOutcome[] = ["success", "miss", "invalid"];
const DURATION_OPTIONS = [10, 15, 20, 30, 45, 60];
const THRESHOLD_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 50];

function cycleArrayValue<T>(values: T[], current: T | null, direction: 1 | -1): T | null {
  if (values.length === 0) {
    return null;
  }

  const currentIndex = current === null ? -1 : values.indexOf(current);
  if (currentIndex < 0) {
    return values[0];
  }

  return values[(currentIndex + direction + values.length) % values.length];
}

function moveFocus<T>(values: T[], current: T, direction: 1 | -1): T {
  const currentIndex = values.indexOf(current);
  if (currentIndex < 0) {
    return values[0];
  }

  return values[(currentIndex + direction + values.length) % values.length];
}

function normalizeButtonId(buttonId: string): KnownButtonId | null {
  switch (buttonId.trim().toLowerCase()) {
    case "redcycle":
    case "rednext":
    case "red-1":
    case "redbutton1":
      return "redCycle";
    case "redconfirm":
    case "redok":
    case "red-2":
    case "redbutton2":
      return "redConfirm";
    case "bluecycle":
    case "bluenext":
    case "blue-1":
    case "bluebutton1":
      return "blueCycle";
    case "blueconfirm":
    case "blueok":
    case "blue-2":
    case "bluebutton2":
      return "blueConfirm";
    case "refereecontrol":
    case "refcontrol":
    case "referee":
    case "judge":
      return "refereeControl";
    default:
      return null;
  }
}

function normalizeButtonAction(action: string): KnownButtonAction | null {
  switch (action.trim().toLowerCase()) {
    case "single":
    case "double":
    case "long":
      return action.trim().toLowerCase() as KnownButtonAction;
    default:
      return null;
  }
}

function getAvailableThrowers(team: Team): Array<{ id: string; name: string }> {
  return matchStateManager
    .getState()
    .teams[team].players.filter((player) => !player.hasActedInRound)
    .map((player) => ({ id: player.id, name: player.name }));
}

function getAvailableBalls(team: Team): Array<{ id: string; name: string }> {
  return matchStateManager
    .getState()
    .balls.filter((ball) => ball.remaining[team] > 0)
    .map((ball) => ({ id: ball.id, name: ball.name }));
}

function syncSelectionControlsAndBroadcast(): void {
  matchStateManager.prepareSelectionControls();
  broadcastState();
}

function recordButtonOutcome(
  buttonId: string,
  action: string,
  timestamp: number,
  handled: boolean,
  summary: string
): void {
  matchStateManager.setLastButtonInput({
    buttonId,
    action,
    timestamp,
    handled,
    summary,
  });
  addEventLog("MESH_BUTTON", `${buttonId} (${action})`, {
    handled,
    summary,
  });
}

function runAutoCalibration(): CalibrationRequest {
  const latestRaw = matchStateManager.getState().sensor.latestRaw;
  if (latestRaw === null) {
    throw new Error("No latest sensor value is available");
  }

  const current = matchStateManager.getCalibration();
  const calibration: CalibrationRequest = {
    minRaw: 0,
    emptyRaw: latestRaw,
    triggerThreshold: current.triggerThreshold,
  };

  matchStateManager.updateCalibration(calibration);
  saveCalibration(calibration);
  addEventLog("AUTO_CALIBRATION", "自動キャリブレーションを実行しました", {
    ...calibration,
  });
  return calibration;
}

function resolveUsingReviewControl(): void {
  const review = matchStateManager.getState().buttonControls.review;
  finalizeResolvedTurn({
    outcome: review.outcome,
    actualDistanceId: review.actualDistanceId,
    foulTeam: review.foulTeam,
    disqualifiedTeam: review.disqualifiedTeam,
    notes: review.notes,
  });
}

function handleThrowingTeamButton(
  team: Team,
  command: "cycle" | "confirm"
): { handled: boolean; summary: string } {
  const state = matchStateManager.getState();
  const currentTurn = state.currentTurn;
  if (state.phase !== "selection" || !currentTurn || currentTurn.throwingTeam !== team) {
    return { handled: false, summary: "このチームは現在、投げる側の選択フェーズではありません" };
  }

  const control = state.buttonControls.team[team];
  if (control.mode === "done") {
    if (command === "confirm") {
      matchStateManager.updateCurrentSelection({
        shooterId: null,
        distanceId: null,
      });
      matchStateManager.prepareSelectionControls();
      broadcastState();
      return { handled: true, summary: "投げる側の選択をやり直します" };
    }
    return { handled: false, summary: "投げる側の選択は確定済みです。確定ボタンでやり直せます" };
  }

  if (control.mode === "shooter") {
    const options = getAvailableThrowers(team);
    if (options.length === 0) {
      return { handled: false, summary: "選択可能な投球者がいません" };
    }

    if (command === "cycle") {
      const next = cycleArrayValue(
        options.map((option) => option.id),
        control.candidatePlayerId,
        1
      );
      matchStateManager.updateTeamControl(team, { candidatePlayerId: next });
      broadcastState();
      return {
        handled: true,
        summary: `投球者候補を ${options.find((option) => option.id === next)?.name ?? "未設定"} に変更しました`,
      };
    }

    if (!control.candidatePlayerId) {
      return { handled: false, summary: "投球者候補がありません" };
    }

    matchStateManager.updateCurrentSelection({ shooterId: control.candidatePlayerId });
    matchStateManager.updateTeamControl(team, { mode: "distance" });
    matchStateManager.prepareSelectionControls();
    broadcastState();
    return {
      handled: true,
      summary: `投球者を ${
        options.find((option) => option.id === control.candidatePlayerId)?.name ?? "不明"
      } に確定しました`,
    };
  }

  if (control.mode === "distance") {
    if (command === "cycle") {
      const next = cycleArrayValue(DISTANCE_ORDER, control.candidateDistanceId, 1);
      matchStateManager.updateTeamControl(team, { candidateDistanceId: next });
      broadcastState();
      return {
        handled: true,
        summary: `距離候補を ${next ?? "未設定"} に変更しました`,
      };
    }

    if (!control.candidateDistanceId) {
      return { handled: false, summary: "距離候補がありません" };
    }

    matchStateManager.updateCurrentSelection({ distanceId: control.candidateDistanceId });
    matchStateManager.updateTeamControl(team, { mode: "done" });
    matchStateManager.prepareSelectionControls();
    broadcastState();
    return {
      handled: true,
      summary: `距離を ${control.candidateDistanceId} に確定しました`,
    };
  }

  return { handled: false, summary: "投げる側ボタンの状態が不正です" };
}

function handleDefendingTeamButton(
  team: Team,
  command: "cycle" | "confirm"
): { handled: boolean; summary: string } {
  const state = matchStateManager.getState();
  const currentTurn = state.currentTurn;
  if (state.phase !== "selection" || !currentTurn || currentTurn.defendingTeam !== team) {
    return { handled: false, summary: "このチームは現在、守る側の選択フェーズではありません" };
  }

  const control = state.buttonControls.team[team];
  if (control.mode === "done") {
    if (command === "confirm") {
      matchStateManager.updateCurrentSelection({
        ballId: null,
        bonusChoice: null,
      });
      matchStateManager.prepareSelectionControls();
      broadcastState();
      return { handled: true, summary: "守る側の選択をやり直します" };
    }
    return { handled: false, summary: "守る側の選択は確定済みです。確定ボタンでやり直せます" };
  }

  if (control.mode === "ball") {
    const options = getAvailableBalls(team);
    if (options.length === 0) {
      return { handled: false, summary: "残っているボールがありません" };
    }

    if (command === "cycle") {
      const next = cycleArrayValue(
        options.map((option) => option.id),
        control.candidateBallId,
        1
      );
      matchStateManager.updateTeamControl(team, { candidateBallId: next });
      broadcastState();
      return {
        handled: true,
        summary: `ボール候補を ${options.find((option) => option.id === next)?.name ?? "未設定"} に変更しました`,
      };
    }

    if (!control.candidateBallId) {
      return { handled: false, summary: "ボール候補がありません" };
    }

    matchStateManager.updateCurrentSelection({
      ballId: control.candidateBallId,
      bonusChoice: null,
    });
    matchStateManager.updateTeamControl(team, { mode: "bonus" });
    matchStateManager.prepareSelectionControls();
    broadcastState();
    return {
      handled: true,
      summary: `ボールを ${
        options.find((option) => option.id === control.candidateBallId)?.name ?? "不明"
      } に確定しました`,
    };
  }

  if (control.mode === "bonus") {
    const choices = matchStateManager.getAvailableBonusChoices(currentTurn);
    if (choices.length === 0) {
      return { handled: false, summary: "追加得点の向きに使える権利がありません" };
    }

    if (command === "cycle") {
      const next = cycleArrayValue(choices, control.candidateBonusChoice, 1);
      matchStateManager.updateTeamControl(team, { candidateBonusChoice: next });
      broadcastState();
      return {
        handled: true,
        summary: `追加得点の向きを ${next === "opponentAverage" ? "自チームへ平均基礎点" : "相手側へ距離点"} に変更しました`,
      };
    }

    if (!control.candidateBonusChoice || !choices.includes(control.candidateBonusChoice)) {
      return { handled: false, summary: "追加得点の向き候補がありません" };
    }

    matchStateManager.updateCurrentSelection({ bonusChoice: control.candidateBonusChoice });
    matchStateManager.updateTeamControl(team, { mode: "done" });
    matchStateManager.prepareSelectionControls();
    broadcastState();
    return {
      handled: true,
      summary: `追加得点の向きを ${
        control.candidateBonusChoice === "opponentAverage" ? "自チームへ平均基礎点" : "相手側へ距離点"
      } に確定しました`,
    };
  }

  return { handled: false, summary: "守る側ボタンの状態が不正です" };
}

function handleSelectionRefereeButton(action: KnownButtonAction): { handled: boolean; summary: string } {
  if (action !== "long") {
    return { handled: false, summary: "選択フェーズでは長押しでターン開始します" };
  }

  if (!isSelectionComplete()) {
    return { handled: false, summary: "選択が未完了のためターン開始できません" };
  }

  const state = matchStateManager.getState();
  if (!state.currentTurn) {
    return { handled: false, summary: "現在のターンがありません" };
  }

  const ballId = state.currentTurn.selection.ballId;
  if (!ballId || !matchStateManager.consumeBall(state.currentTurn.defendingTeam, ballId)) {
    return { handled: false, summary: "選択ボールの残数がありません" };
  }

  matchStateManager.clearSensorTriggeredState();
  matchStateManager.updateCurrentTurn({
    startedAt: Date.now(),
    reviewStartedAt: null,
    sensorTriggeredAt: null,
    outcome: null,
    scoreBreakdown: null,
    foulTeam: null,
    disqualifiedTeam: null,
    notes: null,
  });
  matchStateManager.setPhase("active");
  matchStateManager.clearReviewControls();
  addEventLog("TURN_START", `ターン ${state.currentTurn.turnNumber} を開始しました`);
  broadcastState();
  startTurnTimer();
  return { handled: true, summary: "ターンを開始しました" };
}

function handleSetupOrFinishedRefereeButton(
  action: KnownButtonAction
): { handled: boolean; summary: string } {
  const state = matchStateManager.getState();
  const focus = state.buttonControls.setup.focus;

  if (action === "single" || action === "double") {
    const nextFocus = moveFocus(
      SETUP_FOCUS_ORDER,
      focus,
      action === "single" ? 1 : -1
    );
    matchStateManager.updateSetupControl({ focus: nextFocus });
    broadcastState();
    return { handled: true, summary: `設定カーソルを ${nextFocus} へ移動しました` };
  }

  switch (focus) {
    case "duration": {
      const next = cycleArrayValue(DURATION_OPTIONS, state.turnDurationSec, 1);
      if (next === null) {
        return { handled: false, summary: "制限時間候補がありません" };
      }
      matchStateManager.setTurnDurationSec(next);
      broadcastState();
      return { handled: true, summary: `制限時間を ${next} 秒に変更しました` };
    }
    case "firstThrowingTeam": {
      const nextTeam = otherTeam(state.firstThrowingTeam);
      matchStateManager.setFirstThrowingTeam(nextTeam);
      broadcastState();
      return { handled: true, summary: `先攻を ${nextTeam} に変更しました` };
    }
    case "triggerThreshold": {
      const next = cycleArrayValue(
        THRESHOLD_OPTIONS,
        state.sensor.calibration.triggerThreshold,
        1
      );
      if (next === null) {
        return { handled: false, summary: "閾値候補がありません" };
      }
      const calibration = {
        ...state.sensor.calibration,
        triggerThreshold: next,
      };
      matchStateManager.updateCalibration(calibration);
      saveCalibration(calibration);
      broadcastState();
      return { handled: true, summary: `成功判定閾値を ${next}% に変更しました` };
    }
    case "autoCalibration": {
      const calibration = runAutoCalibration();
      broadcastState();
      return {
        handled: true,
        summary: `自動キャリブレーションを実行しました（emptyRaw=${calibration.emptyRaw}, minRaw=0）`,
      };
    }
    case "startMatch": {
      const setupErrors = getSetupRuleErrors();
      if (setupErrors.length > 0) {
        return { handled: false, summary: setupErrors.join(" / ") };
      }

      if (state.phase === "finished" && state.requiresOvertime) {
        startMatch(state.firstThrowingTeam, true);
        return { handled: true, summary: "延長戦を開始しました" };
      }

      startMatch(state.firstThrowingTeam, false);
      return { handled: true, summary: "試合を開始しました" };
    }
    case "reset": {
      clearTurnTimeout();
      matchStateManager.resetToSetup();
      addEventLog("MATCH_RESET", "試合状態をリセットしました");
      broadcastState();
      return { handled: true, summary: "試合状態をリセットしました" };
    }
    default:
      return { handled: false, summary: "未対応の設定項目です" };
  }
}

function handleReviewRefereeButton(action: KnownButtonAction): { handled: boolean; summary: string } {
  const state = matchStateManager.getState();
  const review = state.buttonControls.review;

  if (action === "single") {
    const nextFocus = moveFocus(REVIEW_FOCUS_ORDER, review.focus, 1);
    matchStateManager.updateReviewControl({ focus: nextFocus });
    broadcastState();
    return { handled: true, summary: `レビュー項目を ${nextFocus} へ移動しました` };
  }

  if (action === "double") {
    switch (review.focus) {
      case "outcome": {
        const next = cycleArrayValue(OUTCOME_ORDER, review.outcome, 1);
        if (!next) {
          return { handled: false, summary: "結果候補がありません" };
        }
        matchStateManager.updateReviewControl({ outcome: next });
        broadcastState();
        return { handled: true, summary: `結果候補を ${next} に変更しました` };
      }
      case "actualDistance": {
        const currentSelectionDistance = state.currentTurn?.selection.distanceId ?? null;
        const values = [currentSelectionDistance, ...DISTANCE_ORDER.filter((value) => value !== currentSelectionDistance)];
        const next = cycleArrayValue(values, review.actualDistanceId, 1);
        matchStateManager.updateReviewControl({ actualDistanceId: next });
        broadcastState();
        return { handled: true, summary: `実距離候補を ${next ?? "選択どおり"} に変更しました` };
      }
      case "foulTeam": {
        const next = cycleArrayValue<Team | null>([null, "red", "blue"], review.foulTeam, 1);
        matchStateManager.updateReviewControl({ foulTeam: next });
        broadcastState();
        return { handled: true, summary: `反則付与先を ${next ?? "なし"} に変更しました` };
      }
      case "disqualifiedTeam": {
        const next = cycleArrayValue<Team | null>(
          [null, "red", "blue"],
          review.disqualifiedTeam,
          1
        );
        matchStateManager.updateReviewControl({ disqualifiedTeam: next });
        broadcastState();
        return { handled: true, summary: `失格対象を ${next ?? "なし"} に変更しました` };
      }
      case "confirm":
        return { handled: false, summary: "confirm 項目では長押しで確定します" };
      default:
        return { handled: false, summary: "レビュー項目が不正です" };
    }
  }

  if (review.focus !== "confirm") {
    return { handled: false, summary: "confirm 項目へ移動して長押しすると確定します" };
  }

  resolveUsingReviewControl();
  return { handled: true, summary: "レビュー内容でターンを確定しました" };
}

function handleRefereeButton(action: KnownButtonAction): { handled: boolean; summary: string } {
  const phase = matchStateManager.getState().phase;

  if (phase === "setup" || phase === "finished") {
    return handleSetupOrFinishedRefereeButton(action);
  }

  if (phase === "selection") {
    return handleSelectionRefereeButton(action);
  }

  if (phase === "active") {
    if (action !== "long") {
      return { handled: false, summary: "投球中は長押しでレビューへ移行します" };
    }
    enterReview("審判ボタンでレビューへ移行しました");
    return { handled: true, summary: "レビューへ移行しました" };
  }

  if (phase === "review") {
    return handleReviewRefereeButton(action);
  }

  return { handled: false, summary: "現在のフェーズでは審判ボタンを処理できません" };
}

function handleMeshButtonInput(
  buttonId: string,
  action: string,
  _timestamp: number
): { handled: boolean; summary: string } {
  const normalizedButtonId = normalizeButtonId(buttonId);
  const normalizedAction = normalizeButtonAction(action);

  if (!normalizedButtonId || !normalizedAction) {
    return { handled: false, summary: "未対応のボタン ID またはアクションです" };
  }

  if (normalizedButtonId === "redCycle") {
    const throwingResult = handleThrowingTeamButton("red", "cycle");
    return throwingResult.handled
      ? throwingResult
      : handleDefendingTeamButton("red", "cycle");
  }

  if (normalizedButtonId === "redConfirm") {
    const throwingResult = handleThrowingTeamButton("red", "confirm");
    return throwingResult.handled
      ? throwingResult
      : handleDefendingTeamButton("red", "confirm");
  }

  if (normalizedButtonId === "blueCycle") {
    const throwingResult = handleThrowingTeamButton("blue", "cycle");
    return throwingResult.handled
      ? throwingResult
      : handleDefendingTeamButton("blue", "cycle");
  }

  if (normalizedButtonId === "blueConfirm") {
    const throwingResult = handleThrowingTeamButton("blue", "confirm");
    return throwingResult.handled
      ? throwingResult
      : handleDefendingTeamButton("blue", "confirm");
  }

  if (normalizedButtonId === "refereeControl") {
    return handleRefereeButton(normalizedAction);
  }

  return { handled: false, summary: "未対応のボタンです" };
}

function getSetupRuleErrors(): string[] {
  const state = matchStateManager.getState();
  const errors: string[] = [];

  const redPlayers = state.teams.red.players.length;
  const bluePlayers = state.teams.blue.players.length;

  if (redPlayers <= 0 || bluePlayers <= 0) {
    errors.push("両チームに最低1人の選手が必要です");
  }
  if (redPlayers !== bluePlayers) {
    errors.push("両チームの人数は同じでなければなりません");
  }

  (["red", "blue"] as Team[]).forEach((team) => {
    const teamState = state.teams[team];
    const expected = getExpectedTotalBasePoints(teamState.players.length);
    if (teamState.totalBasePoints !== expected) {
      errors.push(
        `${teamState.name} の基礎点合計は ${expected} 点である必要があります（現在 ${teamState.totalBasePoints} 点）`
      );
    }
  });

  if (state.balls.length < 3) {
    errors.push("ボールは3種類以上必要です");
  }

  return errors;
}

function isSelectionComplete(): boolean {
  const turn = matchStateManager.getState().currentTurn;
  if (!turn) {
    return false;
  }

  return Boolean(
    turn.selection.shooterId &&
      turn.selection.distanceId &&
      turn.selection.ballId &&
      turn.selection.bonusChoice
  );
}

function createTurnForStart(team: Team, turnNumber: number, roundNumber: number) {
  return matchStateManager.createTurnFor(team, turnNumber, roundNumber);
}

function startMatch(firstThrowingTeam?: Team, isOvertime = false): void {
  clearTurnTimeout();

  const state = matchStateManager.getState();
  const chosenFirstTeam = firstThrowingTeam ?? state.firstThrowingTeam;
  const roundNumber = isOvertime ? state.roundNumber + 1 : 1;
  const turnNumber = isOvertime ? state.history.length + 1 : 1;

  if (!isOvertime) {
    matchStateManager.resetScoresAndRoundFlags();
    matchStateManager.setStartedAt(Date.now());
    matchStateManager.setState({ history: [] });
  } else {
    matchStateManager.resetRoundFlagsOnly();
  }

  matchStateManager.resetBallsToInitial();
  matchStateManager.clearSensorTriggeredState();
  matchStateManager.setRoundNumber(roundNumber);
  matchStateManager.setFirstThrowingTeam(chosenFirstTeam);
  matchStateManager.setFinishedAt(null);
  matchStateManager.setWinner(null, null);
  matchStateManager.setRequiresOvertime(false);
  matchStateManager.setCurrentTurn(createTurnForStart(chosenFirstTeam, turnNumber, roundNumber));
  matchStateManager.setPhase("selection");
  matchStateManager.normalizeSetupCandidates();
  matchStateManager.prepareSelectionControls();

  addEventLog(
    isOvertime ? "OVERTIME_START" : "MATCH_START",
    isOvertime
      ? `延長戦を開始しました（ラウンド ${roundNumber}）`
      : "試合を開始しました"
  );
  broadcastState();
}

function enterReview(reason: string, details?: Record<string, unknown>): void {
  const state = matchStateManager.getState();
  if (state.phase !== "active") {
    return;
  }

  clearTurnTimeout();
  matchStateManager.setPhase("review");
  matchStateManager.updateCurrentTurn({
    reviewStartedAt: Date.now(),
    notes: reason,
  });
  matchStateManager.prepareReviewControls();
  addEventLog("TURN_REVIEW", reason, details);
  broadcastState();
}

function handleTurnTimeout(): void {
  const state = matchStateManager.getState();
  if (state.phase !== "active") {
    return;
  }

  enterReview("投球ターンの制限時間が終了しました");
}

function startTurnTimer(): void {
  clearTurnTimeout();
  const state = matchStateManager.getState();
  turnTimeoutId = setTimeout(handleTurnTimeout, state.turnDurationSec * 1000);
}

function finalizeResolvedTurn(resolution: ResolveTurnRequest): void {
  clearTurnTimeout();

  const state = matchStateManager.getState();
  const turn = state.currentTurn;
  if (!turn || !turn.selection.shooterId || !turn.selection.distanceId || !turn.selection.bonusChoice) {
    throw new Error("Current turn is incomplete");
  }

  const shooter = matchStateManager.getPlayer(turn.throwingTeam, turn.selection.shooterId);
  if (!shooter) {
    throw new Error("Selected shooter not found");
  }

  const actualDistanceId = resolution.actualDistanceId ?? turn.selection.distanceId;
  const notes = resolution.notes?.trim() || null;

  if (resolution.foulTeam) {
    matchStateManager.addFoul(resolution.foulTeam, 1);
  }

  let scoreBreakdown = null;
  if (resolution.outcome === "success") {
    scoreBreakdown = calculateSuccessBreakdown({
      throwingTeam: turn.throwingTeam,
      defendingTeam: turn.defendingTeam,
      shooterBasePoints: shooter.basePoints,
      distanceId: actualDistanceId,
      bonusChoice: turn.selection.bonusChoice,
      defendingAverageBasePoints: state.teams[turn.defendingTeam].averageBasePoints,
    });

    if (scoreBreakdown.redDelta > 0) {
      matchStateManager.addScore("red", scoreBreakdown.redDelta);
    }
    if (scoreBreakdown.blueDelta > 0) {
      matchStateManager.addScore("blue", scoreBreakdown.blueDelta);
    }
  }

  if (resolution.disqualifiedTeam) {
    matchStateManager.disqualifyTeam(resolution.disqualifiedTeam);
  }

  matchStateManager.markPlayerActed(turn.throwingTeam, shooter.id);
  matchStateManager.updateCurrentTurn({
    outcome: resolution.outcome,
    actualDistanceId,
    foulTeam: resolution.foulTeam ?? null,
    disqualifiedTeam: resolution.disqualifiedTeam ?? null,
    scoreBreakdown,
    notes,
  });
  matchStateManager.appendCurrentTurnToHistory();
  matchStateManager.clearSensorTriggeredState();
  matchStateManager.clearReviewControls();

  const updatedState = matchStateManager.getState();
  const updatedTurn = updatedState.currentTurn;
  if (!updatedTurn) {
    throw new Error("Resolved turn disappeared unexpectedly");
  }

  if (resolution.disqualifiedTeam) {
    const winner = otherTeam(resolution.disqualifiedTeam);
    matchStateManager.setWinner(winner, "disqualification");
    matchStateManager.setFinishedAt(Date.now());
    matchStateManager.setPhase("finished");
    matchStateManager.setRequiresOvertime(false);
    matchStateManager.resetButtonControlsForSetup();
    addEventLog(
      "MATCH_DISQUALIFIED",
      `${updatedState.teams[resolution.disqualifiedTeam].name} が失格になりました`,
      { winner }
    );
    broadcastState();
    return;
  }

  const outcomeLabel =
    resolution.outcome === "success"
      ? "成功"
      : resolution.outcome === "miss"
        ? "失敗"
        : "無効";

  addEventLog(
    "TURN_RESOLVED",
    `ターン ${updatedTurn.turnNumber} を ${outcomeLabel} で確定しました`,
    {
      turnNumber: updatedTurn.turnNumber,
      throwingTeam: updatedTurn.throwingTeam,
      foulTeam: resolution.foulTeam ?? null,
      scoreBreakdown,
    }
  );

  if (matchStateManager.haveAllPlayersActedThisRound()) {
    const finalState = matchStateManager.getState();
    const winnerInfo = determineWinner({
      redRawScore: finalState.teams.red.rawScore,
      blueRawScore: finalState.teams.blue.rawScore,
      redFouls: finalState.teams.red.fouls,
      blueFouls: finalState.teams.blue.fouls,
      redDisqualified: finalState.teams.red.disqualified,
      blueDisqualified: finalState.teams.blue.disqualified,
    });

    matchStateManager.setWinner(winnerInfo.winner, winnerInfo.reason);
    matchStateManager.setFinishedAt(Date.now());
    matchStateManager.setPhase("finished");
    matchStateManager.setRequiresOvertime(winnerInfo.winner === "draw");
    matchStateManager.resetButtonControlsForSetup();

    if (winnerInfo.winner === "draw") {
      addEventLog("MATCH_DRAW", "同点です。延長戦が必要です");
    } else if (winnerInfo.winner === "red" || winnerInfo.winner === "blue") {
      const winnerTeam = winnerInfo.winner;
      addEventLog(
        "MATCH_FINISHED",
        `${finalState.teams[winnerTeam].name} の勝ちです`,
        { reason: winnerInfo.reason }
      );
    }

    broadcastState();
    return;
  }

  const nextTurn = matchStateManager.createNextTurn();
  matchStateManager.setCurrentTurn(nextTurn);
  matchStateManager.setPhase("selection");
  matchStateManager.prepareSelectionControls();
  addEventLog(
    "TURN_NEXT",
    `次のターンへ進みます（ターン ${nextTurn.turnNumber}）`,
    {
      throwingTeam: nextTurn.throwingTeam,
      defendingTeam: nextTurn.defendingTeam,
    }
  );
  broadcastState();
}

function requireSelectionPhase(res: Response): boolean {
  const phase = matchStateManager.getState().phase;
  if (phase !== "selection") {
    res.status(400).json({ error: "Current phase is not selection" });
    return false;
  }
  return true;
}

wss.on("connection", (ws) => {
  console.log("WebSocket client connected");
  realtimeManager.addClient(ws);
  ws.send(
    JSON.stringify({
      type: "stateUpdate",
      payload: matchStateManager.getState(),
      timestamp: Date.now(),
    })
  );
});

app.get("/api/state", (_req: Request, res: Response) => {
  res.json(matchStateManager.getState());
});

app.post("/api/setup", (req: Request, res: Response) => {
  const validation = validateSetupMatch(req.body);
  if (!validation.valid) {
    res.status(400).json({ errors: validation.errors });
    return;
  }

  try {
    matchStateManager.applySetup(req.body as SetupMatchRequest);
    matchStateManager.normalizeSetupCandidates();
    addEventLog("SETUP_SAVED", "試合設定を保存しました");
    broadcastState();
    res.json({ success: true });
  } catch (error) {
    console.error("Error saving setup:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/control/auto-calibrate", (_req: Request, res: Response) => {
  try {
    const calibration = runAutoCalibration();
    broadcastState();
    res.json({ success: true, calibration });
  } catch (error) {
    console.error("Error running auto calibration:", error);
    res.status(400).json({
      error: error instanceof Error ? error.message : "Auto calibration failed",
    });
  }
});

app.post("/api/control/start-match", (req: Request, res: Response) => {
  const validation = validateStartMatch(req.body);
  if (!validation.valid) {
    res.status(400).json({ errors: validation.errors });
    return;
  }

  const setupErrors = getSetupRuleErrors();
  if (setupErrors.length > 0) {
    res.status(400).json({ errors: setupErrors });
    return;
  }

  try {
    const { firstThrowingTeam } = (req.body ?? {}) as StartMatchRequest;
    startMatch(firstThrowingTeam, false);
    res.json({ success: true });
  } catch (error) {
    console.error("Error starting match:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/control/start-overtime", (req: Request, res: Response) => {
  const validation = validateStartOvertime(req.body);
  if (!validation.valid) {
    res.status(400).json({ errors: validation.errors });
    return;
  }

  const state = matchStateManager.getState();
  if (!state.requiresOvertime) {
    res.status(400).json({ error: "Overtime is not required right now" });
    return;
  }

  try {
    const { firstThrowingTeam } = (req.body ?? {}) as StartOvertimeRequest;
    startMatch(firstThrowingTeam ?? state.firstThrowingTeam, true);
    res.json({ success: true });
  } catch (error) {
    console.error("Error starting overtime:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/control/reset", (_req: Request, res: Response) => {
  try {
    clearTurnTimeout();
    matchStateManager.resetToSetup();
    addEventLog("MATCH_RESET", "試合状態をリセットしました");
    broadcastState();
    res.json({ success: true });
  } catch (error) {
    console.error("Error resetting match:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/selection/shooter", (req: Request, res: Response) => {
  const validation = validateSelectShooter(req.body);
  if (!validation.valid) {
    res.status(400).json({ errors: validation.errors });
    return;
  }
  if (!requireSelectionPhase(res)) {
    return;
  }

  const state = matchStateManager.getState();
  const turn = state.currentTurn;
  if (!turn) {
    res.status(400).json({ error: "Current turn is missing" });
    return;
  }

  const { playerId } = req.body as SelectShooterRequest;
  const player = matchStateManager.getPlayer(turn.throwingTeam, playerId);
  if (!player) {
    res.status(400).json({ error: "Player not found in throwing team" });
    return;
  }
  if (player.hasActedInRound) {
    res.status(400).json({ error: "Selected player has already thrown in this round" });
    return;
  }

  matchStateManager.updateCurrentSelection({ shooterId: playerId });
  matchStateManager.prepareSelectionControls();
  broadcastState();
  res.json({ success: true });
});

app.post("/api/selection/distance", (req: Request, res: Response) => {
  const validation = validateSelectDistance(req.body);
  if (!validation.valid) {
    res.status(400).json({ errors: validation.errors });
    return;
  }
  if (!requireSelectionPhase(res)) {
    return;
  }

  const { distanceId } = req.body as SelectDistanceRequest;
  matchStateManager.updateCurrentSelection({ distanceId });
  matchStateManager.prepareSelectionControls();
  broadcastState();
  res.json({ success: true });
});

app.post("/api/selection/ball", (req: Request, res: Response) => {
  const validation = validateSelectBall(req.body);
  if (!validation.valid) {
    res.status(400).json({ errors: validation.errors });
    return;
  }
  if (!requireSelectionPhase(res)) {
    return;
  }

  const { ballId } = req.body as SelectBallRequest;
  const currentTurn = matchStateManager.getState().currentTurn;
  if (!currentTurn) {
    res.status(400).json({ error: "Current turn is missing" });
    return;
  }
  const ball = matchStateManager.getBall(ballId);
  if (!ball) {
    res.status(400).json({ error: "Ball not found" });
    return;
  }
  if (ball.remaining[currentTurn.defendingTeam] <= 0) {
    res.status(400).json({ error: "Selected ball has no remaining uses" });
    return;
  }

  matchStateManager.updateCurrentSelection({
    ballId,
    bonusChoice: null,
  });
  matchStateManager.prepareSelectionControls();
  broadcastState();
  res.json({ success: true });
});

app.post("/api/selection/bonus", (req: Request, res: Response) => {
  const validation = validateSelectBonus(req.body);
  if (!validation.valid) {
    res.status(400).json({ errors: validation.errors });
    return;
  }
  if (!requireSelectionPhase(res)) {
    return;
  }

  const currentTurn = matchStateManager.getState().currentTurn;
  if (!currentTurn) {
    res.status(400).json({ error: "Current turn is missing" });
    return;
  }

  const { bonusChoice } = req.body as SelectBonusRequest;
  const allowedChoices = matchStateManager.getAvailableBonusChoices(currentTurn);
  if (!allowedChoices.includes(bonusChoice)) {
    res.status(400).json({ error: "Selected bonus direction has no remaining rights" });
    return;
  }

  matchStateManager.updateCurrentSelection({ bonusChoice });
  matchStateManager.prepareSelectionControls();
  broadcastState();
  res.json({ success: true });
});

app.post("/api/control/start-turn", (_req: Request, res: Response) => {
  const state = matchStateManager.getState();
  if (state.phase !== "selection") {
    res.status(400).json({ error: "Current phase is not selection" });
    return;
  }
  if (!state.currentTurn) {
    res.status(400).json({ error: "Current turn is missing" });
    return;
  }
  if (!isSelectionComplete()) {
    res.status(400).json({ error: "Turn selection is incomplete" });
    return;
  }

  const ballId = state.currentTurn.selection.ballId!;
  if (!matchStateManager.consumeBall(state.currentTurn.defendingTeam, ballId)) {
    res.status(400).json({ error: "Selected ball has no remaining uses" });
    return;
  }

  try {
    matchStateManager.clearSensorTriggeredState();
    matchStateManager.updateCurrentTurn({
      startedAt: Date.now(),
      reviewStartedAt: null,
      sensorTriggeredAt: null,
      outcome: null,
      scoreBreakdown: null,
      foulTeam: null,
      disqualifiedTeam: null,
      notes: null,
    });
    matchStateManager.setPhase("active");
    matchStateManager.clearReviewControls();
    addEventLog("TURN_START", `ターン ${state.currentTurn.turnNumber} を開始しました`);
    broadcastState();
    startTurnTimer();
    res.json({ success: true });
  } catch (error) {
    console.error("Error starting turn:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/control/review-turn", (_req: Request, res: Response) => {
  const state = matchStateManager.getState();
  if (state.phase !== "active") {
    res.status(400).json({ error: "Current phase is not active" });
    return;
  }

  enterReview("審判が手動で判定フェーズへ移行しました");
  res.json({ success: true });
});

app.post("/api/control/resolve-turn", (req: Request, res: Response) => {
  const validation = validateResolveTurn(req.body);
  if (!validation.valid) {
    res.status(400).json({ errors: validation.errors });
    return;
  }

  const phase = matchStateManager.getState().phase;
  if (phase !== "review" && phase !== "active") {
    res.status(400).json({ error: "Current phase is not review or active" });
    return;
  }

  try {
    if (phase === "active") {
      enterReview("判定操作のため手動でレビューへ移行しました");
    }
    finalizeResolvedTurn(req.body as ResolveTurnRequest);
    res.json({ success: true });
  } catch (error) {
    console.error("Error resolving turn:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/control/adjust-foul", (req: Request, res: Response) => {
  const validation = validateAdjustFoul(req.body);
  if (!validation.valid) {
    res.status(400).json({ errors: validation.errors });
    return;
  }

  try {
    const { team, delta } = req.body as AdjustFoulRequest;
    matchStateManager.addFoul(team, delta);
    addEventLog("FOUL_ADJUSTED", `${matchStateManager.getState().teams[team].name} の反則数を ${delta > 0 ? "+1" : "-1"} しました`);
    broadcastState();
    res.json({ success: true });
  } catch (error) {
    console.error("Error adjusting foul count:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/control/adjust-ball", (req: Request, res: Response) => {
  const validation = validateAdjustBall(req.body);
  if (!validation.valid) {
    res.status(400).json({ errors: validation.errors });
    return;
  }

  try {
    const { team, ballId, delta } = req.body as AdjustBallRequest;
    const updated = matchStateManager.adjustBall(team, ballId, delta);
    if (!updated) {
      res.status(400).json({ error: "Ball not found" });
      return;
    }
    addEventLog(
      "BALL_ADJUSTED",
      `${updated.name} の ${team.toUpperCase()} 利用権残数を ${delta > 0 ? "+1" : "-1"} しました`
    );
    broadcastState();
    res.json({ success: true, ball: updated });
  } catch (error) {
    console.error("Error adjusting ball count:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/mesh/sensor", (req: Request, res: Response) => {
  const validation = validateSensorValue(req.body);
  if (!validation.valid) {
    res.status(400).json({ errors: validation.errors });
    return;
  }

  const { raw, timestamp } = req.body as SensorValueRequest;
  const eventTimestamp = timestamp ?? Date.now();

  try {
    const calibration = matchStateManager.getCalibration();
    const normalized = normalizeGoalSensor(raw, calibration);
    matchStateManager.updateSensor(raw, normalized);
    realtimeManager.broadcastSensorValue(raw, normalized);

    const state = matchStateManager.getState();
    if (
      state.phase === "active" &&
      !state.sensor.successDetected &&
      normalized <= calibration.triggerThreshold
    ) {
      matchStateManager.markSensorTriggered(eventTimestamp);
      addEventLog("GOAL_SENSOR", "ゴールセンサーが成功を検知しました", {
        raw,
        normalized,
      });
      enterReview("ゴールセンサーが成功を検知しました", { raw, normalized });
    }

    res.json({ success: true, normalized });
  } catch (error) {
    console.error("Error processing sensor value:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/mesh/button", (req: Request, res: Response) => {
  const validation = validateMeshButton(req.body);
  if (!validation.valid) {
    res.status(400).json({ errors: validation.errors });
    return;
  }

  const { buttonId, action, timestamp } = req.body as {
    buttonId: string;
    action: string;
    timestamp?: number;
  };

  try {
    const eventTimestamp = timestamp ?? Date.now();
    const result = handleMeshButtonInput(buttonId, action, eventTimestamp);
    recordButtonOutcome(buttonId, action, eventTimestamp, result.handled, result.summary);
    broadcastState();
    res.json({ success: true, handled: result.handled, summary: result.summary });
  } catch (error) {
    console.error("Error handling mesh button:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/calibration", (req: Request, res: Response) => {
  const validation = validateCalibration(req.body);
  if (!validation.valid) {
    res.status(400).json({ errors: validation.errors });
    return;
  }

  try {
    const calibration = req.body as CalibrationRequest;
    matchStateManager.updateCalibration(calibration);
    saveCalibration(calibration);
    addEventLog("CALIBRATION", "センサーキャリブレーションを手動更新しました", {
      ...calibration,
    });
    broadcastState();
    res.json({ success: true });
  } catch (error) {
    console.error("Error updating calibration:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/calibration/capture-empty", (_req: Request, res: Response) => {
  const latestRaw = matchStateManager.getState().sensor.latestRaw;
  if (latestRaw === null) {
    res.status(400).json({ error: "No latest sensor value is available" });
    return;
  }

  try {
    const current = matchStateManager.getCalibration();
    const calibration = {
      ...current,
      emptyRaw: latestRaw,
    };
    matchStateManager.updateCalibration(calibration);
    saveCalibration(calibration);
    addEventLog("CALIBRATION_CAPTURE", "現在値を空ゴール値として保存しました", calibration);
    broadcastState();
    res.json({ success: true, calibration });
  } catch (error) {
    console.error("Error capturing empty calibration:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/calibration/capture-blocked", (_req: Request, res: Response) => {
  try {
    const current = matchStateManager.getCalibration();
    const calibration = {
      ...current,
      minRaw: 0,
    };
    matchStateManager.updateCalibration(calibration);
    saveCalibration(calibration);
    addEventLog("CALIBRATION_CAPTURE", "遮光時の値を 0 として保存しました", calibration);
    broadcastState();
    res.json({ success: true, calibration });
  } catch (error) {
    console.error("Error capturing blocked calibration:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

const audioDir = path.join(__dirname, "..", "音源");
app.use("/audio", express.static(audioDir));

const clientDist = path.join(__dirname, "..", "dist", "client");
app.use(express.static(clientDist));

app.get("*", (_req: Request, res: Response) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
);

const PORT = defaultConfig.PORT;
server.listen(PORT, defaultConfig.HOST, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log("WebSocket server ready");
});
