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
  DISTANCE_OPTIONS,
  determineWinner,
  getExpectedTotalBasePoints,
  normalizeGoalSensor,
} from "./scoring";
import {
  validateAdjustFoul,
  validateCalibration,
  validateMeshButton,
  validateResolveTurn,
  validateSelectBonus,
  validateSelectDistance,
  validateSensorValue,
  validateSetDraftOrder,
  validateSetupMatch,
  validateStartMatch,
  validateStartOvertime,
} from "./validation";
import {
  AdjustFoulRequest,
  CalibrationRequest,
  DistanceId,
  EventLogEntry,
  KnownButtonAction,
  KnownButtonId,
  ResolveTurnRequest,
  ReviewControlFocus,
  SelectBonusRequest,
  SelectDistanceRequest,
  SensorValueRequest,
  SetDraftOrderRequest,
  SetupControlFocus,
  SetupMatchRequest,
  StartMatchRequest,
  StartOvertimeRequest,
  Team,
  TurnOutcome,
  TurnState,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());

let phaseTimeoutId: NodeJS.Timeout | null = null;
let pendingRefereeSingle: { timerId: NodeJS.Timeout; timestamp: number } | null = null;

const SETUP_FOCUS_ORDER: SetupControlFocus[] = [
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
const DISTANCE_ORDER: DistanceId[] = DISTANCE_OPTIONS;
const OUTCOME_ORDER: TurnOutcome[] = ["success", "miss", "invalid"];
const THRESHOLD_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 50];
const REFEREE_DOUBLE_CLICK_WINDOW_MS = 360;

interface MeshButtonHandleResult {
  handled: boolean;
  summary: string;
  recordNow?: boolean;
  broadcastNow?: boolean;
  recordedAction?: KnownButtonAction;
}

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

function clearPhaseTimeout(): void {
  if (phaseTimeoutId) {
    clearTimeout(phaseTimeoutId);
    phaseTimeoutId = null;
  }
}

function cycleArrayValue<T>(values: T[], current: T | null, direction: 1 | -1): T | null {
  if (values.length === 0) {
    return null;
  }

  const currentIndex = values.findIndex((value) => value === current);
  if (currentIndex < 0) {
    return values[0];
  }

  return values[(currentIndex + direction + values.length) % values.length];
}

function pickRandomValue<T>(values: T[]): T | null {
  if (values.length === 0) {
    return null;
  }

  const index = Math.floor(Math.random() * values.length);
  return values[index] ?? null;
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

function formatDistanceLabel(distance: number | null): string {
  return distance === null ? "未設定" : `${distance}m`;
}

function getDraftOrderSummary(team: Team): string {
  const state = matchStateManager.getState();
  return state.teams[team].throwOrderPlayerIds
    .map((playerId) => matchStateManager.getPlayer(team, playerId)?.name ?? "不明")
    .join(" → ");
}

function getBonusChoiceSummary(turn: TurnState, choice: "distance" | "opponentAverage"): string {
  const state = matchStateManager.getState();
  return choice === "distance"
    ? `${state.teams[turn.throwingTeam].name} が自分の距離点権を使います`
    : `${state.teams[turn.defendingTeam].name} が自分の平均基礎点権を使います`;
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

function clearPendingRefereeSingle(): void {
  if (!pendingRefereeSingle) {
    return;
  }
  clearTimeout(pendingRefereeSingle.timerId);
  pendingRefereeSingle = null;
}

function flushPendingRefereeSingle(): void {
  if (!pendingRefereeSingle) {
    return;
  }

  const { timestamp } = pendingRefereeSingle;
  clearPendingRefereeSingle();
  const result = handleRefereeButton("single");
  recordButtonOutcome("refereeControl", "single", timestamp, result.handled, result.summary);
  broadcastState();
}

function handleRefereeButtonWithFallback(
  action: KnownButtonAction,
  timestamp: number
): MeshButtonHandleResult {
  if (action === "single") {
    if (
      pendingRefereeSingle &&
      timestamp - pendingRefereeSingle.timestamp <= REFEREE_DOUBLE_CLICK_WINDOW_MS
    ) {
      clearPendingRefereeSingle();
      const result = handleRefereeButton("double");
      return {
        ...result,
        recordedAction: "double",
      };
    }

    if (pendingRefereeSingle) {
      flushPendingRefereeSingle();
    }

    pendingRefereeSingle = {
      timestamp,
      timerId: setTimeout(() => {
        const queued = pendingRefereeSingle;
        if (!queued || queued.timestamp !== timestamp) {
          return;
        }
        flushPendingRefereeSingle();
      }, REFEREE_DOUBLE_CLICK_WINDOW_MS),
    };

    return {
      handled: true,
      summary: "審判単押しを受け付けました",
      recordNow: false,
      broadcastNow: false,
    };
  }

  clearPendingRefereeSingle();
  return handleRefereeButton(action);
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

  return errors;
}

function isSelectionComplete(): boolean {
  const turn = matchStateManager.getState().currentTurn;
  if (!turn) {
    return false;
  }

  return Boolean(turn.selection.shooterId && turn.selection.distanceId && turn.selection.bonusChoice);
}

function getPhaseDurationSec(): number | null {
  const state = matchStateManager.getState();
  if (state.phase === "draft") {
    return state.draftDurationSec;
  }
  if (state.phase === "selection") {
    return state.selectionDurationSec;
  }
  if (state.phase === "active") {
    return state.activeDurationSec;
  }

  return null;
}

function startPhaseTimer(): void {
  clearPhaseTimeout();
  const durationSec = getPhaseDurationSec();
  if (durationSec === null) {
    return;
  }
  phaseTimeoutId = setTimeout(handlePhaseTimeout, durationSec * 1000);
}

function beginSelectionPhase(turn: TurnState, message: string, eventType = "TURN_SELECTION_START"): void {
  clearPhaseTimeout();
  matchStateManager.clearSensorTriggeredState();
  matchStateManager.setCurrentTurn(turn);
  matchStateManager.setPhase("selection", Date.now());
  matchStateManager.prepareSelectionControls();
  addEventLog(eventType, message, {
    turnNumber: turn.turnNumber,
    throwingTeam: turn.throwingTeam,
    defendingTeam: turn.defendingTeam,
    shooterId: turn.selection.shooterId,
  });
  broadcastState();
  startPhaseTimer();
}

function startNextTurnOrFinishFromResult(): void {
  const state = matchStateManager.getState();
  const turn = state.currentTurn;
  if (!turn) {
    throw new Error("Current turn is missing");
  }

  if (turn.disqualifiedTeam) {
    const winner = otherTeam(turn.disqualifiedTeam);
    matchStateManager.setWinner(winner, "disqualification");
    matchStateManager.setFinishedAt(Date.now());
    matchStateManager.setPhase("finished", null);
    matchStateManager.setRequiresOvertime(false);
    matchStateManager.resetButtonControlsForSetup();
    matchStateManager.updateSetupControl({ focus: "startMatch" });
    addEventLog(
      "MATCH_DISQUALIFIED",
      `${state.teams[turn.disqualifiedTeam].name} が失格になりました`,
      { winner }
    );
    broadcastState();
    return;
  }

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
    matchStateManager.setPhase("finished", null);
    matchStateManager.setRequiresOvertime(winnerInfo.winner === "draw");
    matchStateManager.resetButtonControlsForSetup();
    matchStateManager.updateSetupControl({ focus: "startMatch" });

    if (winnerInfo.winner === "draw") {
      addEventLog("MATCH_DRAW", "同点です。延長戦が必要です");
    } else if (winnerInfo.winner === "red" || winnerInfo.winner === "blue") {
      addEventLog("MATCH_FINISHED", `${finalState.teams[winnerInfo.winner].name} の勝ちです`, {
        reason: winnerInfo.reason,
      });
    }

    broadcastState();
    return;
  }

  const nextTurn = matchStateManager.createNextTurn();
  beginSelectionPhase(
    nextTurn,
    `次のターンを開始します（ターン ${nextTurn.turnNumber}）`,
    "TURN_NEXT"
  );
}

function finalizeDraftAndWaitForSelectionStart(message: string): void {
  clearPhaseTimeout();
  matchStateManager.autoCompleteDraftOrders();
  const firstTurn = matchStateManager.createInitialTurn();
  matchStateManager.clearSensorTriggeredState();
  matchStateManager.setCurrentTurn(firstTurn);
  matchStateManager.prepareSelectionControls();
  matchStateManager.setPhase("selectionReady", Date.now());
  addEventLog("DRAFT_COMPLETED", message, {
    redOrder: getDraftOrderSummary("red"),
    blueOrder: getDraftOrderSummary("blue"),
    turnNumber: firstTurn.turnNumber,
    throwingTeam: firstTurn.throwingTeam,
    shooterId: firstTurn.selection.shooterId,
  });
  broadcastState();
}

function lockCurrentSelectionFromCandidates(options?: {
  allowRandomFallback?: boolean;
}): { complete: boolean; usedRandomFallback: boolean } {
  const state = matchStateManager.getState();
  const turn = state.currentTurn;
  if (!turn) {
    return { complete: false, usedRandomFallback: false };
  }

  const throwingControl = state.buttonControls.team[turn.throwingTeam];
  const defendingControl = state.buttonControls.team[turn.defendingTeam];
  const availableBonusChoices = matchStateManager.getAvailableBonusChoices(turn);
  const allowRandomFallback = options?.allowRandomFallback ?? false;
  let usedRandomFallback = false;

  const candidateDistance =
    throwingControl.candidateDistanceId !== null && DISTANCE_ORDER.includes(throwingControl.candidateDistanceId)
      ? throwingControl.candidateDistanceId
      : null;
  const candidateBonusChoice =
    defendingControl.candidateBonusChoice !== null &&
    availableBonusChoices.includes(defendingControl.candidateBonusChoice)
      ? defendingControl.candidateBonusChoice
      : null;

  if (!turn.selection.distanceId) {
    const nextDistance =
      candidateDistance ??
      (allowRandomFallback
        ? (() => {
            usedRandomFallback = true;
            return pickRandomValue(DISTANCE_ORDER);
          })()
        : null);
    matchStateManager.updateCurrentSelection({
      distanceId: nextDistance,
    });
  }

  const refreshedTurn = matchStateManager.getState().currentTurn;
  if (refreshedTurn && !refreshedTurn.selection.bonusChoice) {
    const nextBonusChoice =
      candidateBonusChoice ??
      (allowRandomFallback
        ? (() => {
            usedRandomFallback = true;
            return pickRandomValue(availableBonusChoices);
          })()
        : null);
    matchStateManager.updateCurrentSelection({
      bonusChoice: nextBonusChoice,
    });
  }

  matchStateManager.prepareSelectionControls();
  return {
    complete: isSelectionComplete(),
    usedRandomFallback,
  };
}

function enterReview(reason: string, details?: Record<string, unknown>): void {
  const state = matchStateManager.getState();
  if (state.phase !== "active") {
    return;
  }

  clearPhaseTimeout();
  matchStateManager.setPhase("review", null);
  matchStateManager.updateCurrentTurn({
    reviewStartedAt: Date.now(),
    notes: reason,
  });
  matchStateManager.prepareReviewControls();
  addEventLog("TURN_REVIEW", reason, details);
  broadcastState();
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

function resolveActiveTurnImmediately(timeoutTriggered = false): void {
  const state = matchStateManager.getState();
  const turn = state.currentTurn;
  if (!turn) {
    throw new Error("Current turn is missing");
  }

  finalizeResolvedTurn({
    outcome: turn.sensorTriggeredAt ? "success" : "miss",
    actualDistanceId: turn.selection.distanceId,
    foulTeam: null,
    disqualifiedTeam: null,
    notes: timeoutTriggered ? "投球時間が終了しました" : turn.notes,
  });
}

function handlePhaseTimeout(): void {
  const state = matchStateManager.getState();

  if (state.phase === "draft") {
    finalizeDraftAndWaitForSelectionStart("投球順決定の制限時間が終了したため、残りを自動確定しました");
    return;
  }

  if (state.phase === "selection") {
    const selectionResult = lockCurrentSelectionFromCandidates({ allowRandomFallback: true });
    if (!selectionResult.complete) {
      addEventLog("TURN_SELECTION_TIMEOUT", "選択時間が終了しましたが、選択を確定できませんでした");
      broadcastState();
      return;
    }
    matchStateManager.setPhase("confirmation", null);
    matchStateManager.updateCurrentTurn({
      notes: selectionResult.usedRandomFallback
        ? "選択時間終了のため、自動補完して確認画面へ進みました"
        : "選択時間終了のため、自動で確認画面へ進みました",
    });
    addEventLog(
      "TURN_SELECTION_TIMEOUT",
      selectionResult.usedRandomFallback
        ? "選択時間が終了したため、不足項目を自動補完して確認画面へ進みました"
        : "選択時間が終了したため、確認画面へ進みました"
    );
    broadcastState();
    return;
  }

  if (state.phase === "active") {
    addEventLog("TURN_TIMEOUT", "投球時間が終了しました");
    resolveActiveTurnImmediately(true);
  }
}

function handleOrderTeamButton(
  team: Team,
  command: "cycle" | "confirm"
): { handled: boolean; summary: string } {
  const state = matchStateManager.getState();
  if (state.phase !== "draft") {
    return { handled: false, summary: "現在は投球順決定フェーズではありません" };
  }

  const control = state.buttonControls.team[team];
  const remainingPlayers = matchStateManager.getRemainingDraftPlayers(team);

  if (remainingPlayers.length === 0) {
    return { handled: false, summary: `${state.teams[team].name} の投球順は確定済みです` };
  }

  if (command === "cycle") {
    const next = cycleArrayValue(
      remainingPlayers.map((player) => player.id),
      control.candidatePlayerId,
      1
    );
    const nextName = next ? matchStateManager.getPlayer(team, next)?.name ?? "未設定" : "未設定";
    matchStateManager.updateTeamControl(team, { candidatePlayerId: next });
    broadcastState();
    return {
      handled: true,
      summary: `候補を ${nextName} に変更しました`,
    };
  }

  const candidatePlayerId = control.candidatePlayerId ?? remainingPlayers[0]?.id ?? null;
  if (!candidatePlayerId) {
    return { handled: false, summary: "候補選手がいません" };
  }

  if (!matchStateManager.appendDraftOrder(team, candidatePlayerId)) {
    return { handled: false, summary: "その選手は投球順に追加できません" };
  }

  matchStateManager.prepareDraftControls();

  const playerName = matchStateManager.getPlayer(team, candidatePlayerId)?.name ?? "不明";
  if (matchStateManager.isDraftComplete()) {
    finalizeDraftAndWaitForSelectionStart("両チームの投球順が確定しました");
    return { handled: true, summary: `${playerName} を追加し、審判の合図待ちに入りました` };
  }

  broadcastState();
  return { handled: true, summary: `${playerName} を投球順に追加しました` };
}

function handleThrowingTeamButton(
  team: Team,
  command: "cycle" | "confirm"
): { handled: boolean; summary: string } {
  const state = matchStateManager.getState();
  const currentTurn = state.currentTurn;
  if (state.phase !== "selection" || !currentTurn || currentTurn.throwingTeam !== team) {
    return { handled: false, summary: "このチームは現在、距離選択フェーズではありません" };
  }

  const control = state.buttonControls.team[team];
  if (control.mode === "done") {
    if (command === "confirm") {
      matchStateManager.updateCurrentSelection({ distanceId: null });
      matchStateManager.prepareSelectionControls();
      broadcastState();
      return { handled: true, summary: "距離選択をやり直します" };
    }
    return { handled: false, summary: "距離は確定済みです。確定ボタンでやり直せます" };
  }

  if (command === "cycle") {
    const next = cycleArrayValue(DISTANCE_ORDER, control.candidateDistanceId, 1);
    matchStateManager.updateTeamControl(team, { candidateDistanceId: next });
    broadcastState();
    return {
      handled: true,
      summary: `距離候補を ${formatDistanceLabel(next)} に変更しました`,
    };
  }

  if (!control.candidateDistanceId) {
    return { handled: false, summary: "距離候補がありません" };
  }

  matchStateManager.updateCurrentSelection({ distanceId: control.candidateDistanceId });
  matchStateManager.prepareSelectionControls();
  broadcastState();
  return {
    handled: true,
    summary: `距離を ${formatDistanceLabel(control.candidateDistanceId)} に確定しました`,
  };
}

function handleDefendingTeamButton(
  team: Team,
  command: "cycle" | "confirm"
): { handled: boolean; summary: string } {
  const state = matchStateManager.getState();
  const currentTurn = state.currentTurn;
  if (state.phase !== "selection" || !currentTurn || currentTurn.defendingTeam !== team) {
    return { handled: false, summary: "このチームは現在、追加得点権の選択フェーズではありません" };
  }

  const control = state.buttonControls.team[team];
  const choices = matchStateManager.getAvailableBonusChoices(currentTurn);
  if (choices.length === 0) {
    return { handled: false, summary: "使える追加得点権がありません" };
  }

  if (control.mode === "done") {
    if (command === "confirm") {
      matchStateManager.updateCurrentSelection({ bonusChoice: null });
      matchStateManager.prepareSelectionControls();
      broadcastState();
      return { handled: true, summary: "追加得点権の選択をやり直します" };
    }
    return { handled: false, summary: "追加得点権は確定済みです。確定ボタンでやり直せます" };
  }

  if (command === "cycle") {
    const next = cycleArrayValue(choices, control.candidateBonusChoice, 1);
    if (!next) {
      return { handled: false, summary: "追加得点権の候補がありません" };
    }
    matchStateManager.updateTeamControl(team, { candidateBonusChoice: next });
    broadcastState();
    return {
      handled: true,
      summary: `追加得点権を ${getBonusChoiceSummary(currentTurn, next)} に変更しました`,
    };
  }

  if (!control.candidateBonusChoice || !choices.includes(control.candidateBonusChoice)) {
    return { handled: false, summary: "追加得点権の候補がありません" };
  }

  matchStateManager.updateCurrentSelection({ bonusChoice: control.candidateBonusChoice });
  matchStateManager.prepareSelectionControls();
  broadcastState();
  return {
    handled: true,
    summary: `追加得点権を ${getBonusChoiceSummary(currentTurn, control.candidateBonusChoice)} に確定しました`,
  };
}

function handleDraftRefereeButton(action: KnownButtonAction): { handled: boolean; summary: string } {
  if (action !== "long") {
    return { handled: false, summary: "投球順決定中は長押しで残りを確定して次へ進みます" };
  }

  finalizeDraftAndWaitForSelectionStart("審判が投球順決定を終了しました");
  return { handled: true, summary: "投球順を確定し、ターン選択の開始待ちに入りました" };
}

function handleSelectionReadyRefereeButton(action: KnownButtonAction): { handled: boolean; summary: string } {
  if (action !== "long") {
    return { handled: false, summary: "選択開始待ちでは長押しでターン選択を始めます" };
  }

  const currentTurn = matchStateManager.getState().currentTurn;
  if (!currentTurn) {
    return { handled: false, summary: "開始するターンがありません" };
  }

  beginSelectionPhase(currentTurn, "審判の合図でターン選択を開始します");
  return { handled: true, summary: "ターン選択を開始しました" };
}

function handleSelectionRefereeButton(action: KnownButtonAction): { handled: boolean; summary: string } {
  if (action !== "long") {
    return { handled: false, summary: "選択フェーズでは長押しで確認画面へ進みます" };
  }

  const selectionResult = lockCurrentSelectionFromCandidates();
  if (!selectionResult.complete) {
    return { handled: false, summary: "選択が未完了のため確認へ進めません" };
  }

  clearPhaseTimeout();
  matchStateManager.setPhase("confirmation", null);
  matchStateManager.updateCurrentTurn({
    notes: "両チームの選択確認中です",
  });
  addEventLog("TURN_CONFIRMATION", "選択確認画面へ進みました");
  broadcastState();
  return { handled: true, summary: "選択確認画面へ進みました" };
}

function handleConfirmationRefereeButton(action: KnownButtonAction): { handled: boolean; summary: string } {
  if (action !== "long") {
    return { handled: false, summary: "選択確認フェーズでは長押しで投球開始します" };
  }

  const state = matchStateManager.getState();
  if (!state.currentTurn) {
    return { handled: false, summary: "現在のターンがありません" };
  }

  const startedAt = Date.now();
  matchStateManager.clearSensorTriggeredState();
  matchStateManager.updateCurrentTurn({
    startedAt,
    reviewStartedAt: null,
    resolvedAt: null,
    sensorTriggeredAt: null,
    outcome: null,
    actualDistanceId: null,
    foulTeam: null,
    disqualifiedTeam: null,
    scoreBreakdown: null,
    notes: null,
  });
  matchStateManager.clearReviewControls();
  matchStateManager.setPhase("active", startedAt);
  addEventLog("TURN_START", `ターン ${state.currentTurn.turnNumber} を開始しました`);
  broadcastState();
  startPhaseTimer();
  return { handled: true, summary: "投球を開始しました" };
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
    case "firstThrowingTeam": {
      const nextTeam = otherTeam(state.firstThrowingTeam);
      matchStateManager.setFirstThrowingTeam(nextTeam);
      broadcastState();
      return { handled: true, summary: `先攻を ${state.teams[nextTeam].name} に変更しました` };
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
      return { handled: true, summary: "投球順決定を開始しました" };
    }
    case "reset": {
      clearPhaseTimeout();
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
        const values = [
          currentSelectionDistance,
          ...DISTANCE_ORDER.filter((value) => value !== currentSelectionDistance),
        ];
        const next = cycleArrayValue(values, review.actualDistanceId, 1);
        matchStateManager.updateReviewControl({ actualDistanceId: next });
        broadcastState();
        return {
          handled: true,
          summary: `実距離候補を ${next === null ? "選択どおり" : formatDistanceLabel(next)} に変更しました`,
        };
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

  resolveUsingReviewControl();
  return { handled: true, summary: "レビュー内容でターン結果を確定しました" };
}

function handleResultRefereeButton(action: KnownButtonAction): { handled: boolean; summary: string } {
  if (action !== "long") {
    return { handled: false, summary: "結果画面では長押しで次のターンへ進みます" };
  }

  startNextTurnOrFinishFromResult();
  return { handled: true, summary: "次のステージへ進みました" };
}

function handleRefereeButton(action: KnownButtonAction): { handled: boolean; summary: string } {
  const phase = matchStateManager.getState().phase;

  if (phase === "setup" || phase === "finished") {
    return handleSetupOrFinishedRefereeButton(action);
  }

  if (phase === "draft") {
    return handleDraftRefereeButton(action);
  }

  if (phase === "selectionReady") {
    return handleSelectionReadyRefereeButton(action);
  }

  if (phase === "selection") {
    return handleSelectionRefereeButton(action);
  }

  if (phase === "confirmation") {
    return handleConfirmationRefereeButton(action);
  }

  if (phase === "active") {
    if (action === "double") {
      enterReview("審判が詳細判定のためレビューへ移行しました");
      return { handled: true, summary: "詳細判定画面を開きました" };
    }

    if (action !== "long") {
      return { handled: false, summary: "投球中は長押しで確定、ダブルクリックで詳細判定です" };
    }

    resolveActiveTurnImmediately(false);
    return { handled: true, summary: "現在の判定内容でターンを確定しました" };
  }

  if (phase === "review") {
    return handleReviewRefereeButton(action);
  }

  if (phase === "result") {
    return handleResultRefereeButton(action);
  }

  return { handled: false, summary: "現在のフェーズでは審判ボタンを処理できません" };
}

function handleMeshButtonInput(
  buttonId: string,
  action: string,
  timestamp: number
): MeshButtonHandleResult {
  const normalizedButtonId = normalizeButtonId(buttonId);
  const normalizedAction = normalizeButtonAction(action);

  if (!normalizedButtonId || !normalizedAction) {
    return { handled: false, summary: "未対応のボタン ID またはアクションです" };
  }

  if (normalizedButtonId === "redCycle") {
    const orderResult = handleOrderTeamButton("red", "cycle");
    if (orderResult.handled || matchStateManager.getState().phase === "draft") {
      return orderResult;
    }
    const throwingResult = handleThrowingTeamButton("red", "cycle");
    return throwingResult.handled ? throwingResult : handleDefendingTeamButton("red", "cycle");
  }

  if (normalizedButtonId === "redConfirm") {
    const orderResult = handleOrderTeamButton("red", "confirm");
    if (orderResult.handled || matchStateManager.getState().phase === "draft") {
      return orderResult;
    }
    const throwingResult = handleThrowingTeamButton("red", "confirm");
    return throwingResult.handled ? throwingResult : handleDefendingTeamButton("red", "confirm");
  }

  if (normalizedButtonId === "blueCycle") {
    const orderResult = handleOrderTeamButton("blue", "cycle");
    if (orderResult.handled || matchStateManager.getState().phase === "draft") {
      return orderResult;
    }
    const throwingResult = handleThrowingTeamButton("blue", "cycle");
    return throwingResult.handled ? throwingResult : handleDefendingTeamButton("blue", "cycle");
  }

  if (normalizedButtonId === "blueConfirm") {
    const orderResult = handleOrderTeamButton("blue", "confirm");
    if (orderResult.handled || matchStateManager.getState().phase === "draft") {
      return orderResult;
    }
    const throwingResult = handleThrowingTeamButton("blue", "confirm");
    return throwingResult.handled ? throwingResult : handleDefendingTeamButton("blue", "confirm");
  }

  if (normalizedButtonId === "refereeControl") {
    return handleRefereeButtonWithFallback(normalizedAction, timestamp);
  }

  return { handled: false, summary: "未対応のボタンです" };
}

function startMatch(firstThrowingTeam?: Team, isOvertime = false): void {
  clearPhaseTimeout();

  const state = matchStateManager.getState();
  const chosenFirstTeam = firstThrowingTeam ?? state.firstThrowingTeam;

  matchStateManager.clearSensorTriggeredState();
  matchStateManager.setIsOvertime(isOvertime);
  matchStateManager.setFirstThrowingTeam(chosenFirstTeam);
  matchStateManager.setFinishedAt(null);
  matchStateManager.setWinner(null, null);
  matchStateManager.setRequiresOvertime(false);
  matchStateManager.setCurrentTurn(null);
  matchStateManager.normalizeSetupCandidates();

  if (!isOvertime) {
    matchStateManager.resetScoresAndRoundFlags();
    matchStateManager.clearThrowOrders();
    matchStateManager.setStartedAt(Date.now());
    matchStateManager.setState({ history: [] });
    matchStateManager.prepareDraftControls();
    matchStateManager.setPhase("draft", Date.now());
    addEventLog("MATCH_START", "試合を開始しました。投球順決定を始めてください");
    broadcastState();
    startPhaseTimer();
    return;
  }

  matchStateManager.resetRoundFlagsOnly();
  const turnNumber = state.history.length + 1;
  const firstTurn = matchStateManager.createTurnFor(chosenFirstTeam, turnNumber, true);
  addEventLog("OVERTIME_START", "延長戦を開始しました");
  beginSelectionPhase(firstTurn, "延長戦のターン選択を開始します");
}

function finalizeResolvedTurn(resolution: ResolveTurnRequest): void {
  clearPhaseTimeout();

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
    resolvedAt: Date.now(),
  });
  matchStateManager.appendCurrentTurnToHistory();
  matchStateManager.clearSensorTriggeredState();
  matchStateManager.clearReviewControls();
  matchStateManager.setPhase("result", null);

  const updatedTurn = matchStateManager.getState().currentTurn;
  if (!updatedTurn) {
    throw new Error("Resolved turn disappeared unexpectedly");
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
      bonusChoice: updatedTurn.selection.bonusChoice,
      foulTeam: resolution.foulTeam ?? null,
      disqualifiedTeam: resolution.disqualifiedTeam ?? null,
      scoreBreakdown,
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

app.post("/api/draft/order", (req: Request, res: Response) => {
  const validation = validateSetDraftOrder(req.body);
  if (!validation.valid) {
    res.status(400).json({ errors: validation.errors });
    return;
  }

  const state = matchStateManager.getState();
  if (state.phase !== "draft") {
    res.status(400).json({ error: "Current phase is not draft" });
    return;
  }

  const { team, playerIds } = req.body as SetDraftOrderRequest;
  const teamPlayers = state.teams[team].players.map((player) => player.id);
  const uniquePlayerIds = Array.from(new Set(playerIds));

  if (uniquePlayerIds.length !== playerIds.length) {
    res.status(400).json({ error: "playerIds must not contain duplicates" });
    return;
  }
  if (uniquePlayerIds.some((playerId) => !teamPlayers.includes(playerId))) {
    res.status(400).json({ error: "playerIds must belong to the specified team" });
    return;
  }
  if (uniquePlayerIds.length > teamPlayers.length) {
    res.status(400).json({ error: "playerIds is longer than the number of team players" });
    return;
  }

  try {
    matchStateManager.setDraftOrder(team, uniquePlayerIds);
    matchStateManager.prepareDraftControls();

    if (matchStateManager.isDraftComplete()) {
      finalizeDraftAndWaitForSelectionStart("手動設定で投球順が確定しました");
    } else {
      broadcastState();
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error saving draft order:", error);
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
    clearPhaseTimeout();
    matchStateManager.resetToSetup();
    addEventLog("MATCH_RESET", "試合状態をリセットしました");
    broadcastState();
    res.json({ success: true });
  } catch (error) {
    console.error("Error resetting match:", error);
    res.status(500).json({ error: "Internal server error" });
  }
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

app.post("/api/control/advance", (_req: Request, res: Response) => {
  try {
    const result = handleRefereeButton("long");
    recordButtonOutcome("refereeControl", "long", Date.now(), result.handled, result.summary);
    broadcastState();
    res.json({ success: true, handled: result.handled, summary: result.summary });
  } catch (error) {
    console.error("Error advancing phase:", error);
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
      matchStateManager.updateCurrentTurn({
        notes: "ゴールセンサーが成功を検知しました",
      });
      addEventLog("GOAL_SENSOR", "ゴールセンサーが成功を検知しました", {
        raw,
        normalized,
      });
      broadcastState();
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
    if (result.recordNow !== false) {
      recordButtonOutcome(
        buttonId,
        result.recordedAction ?? action,
        eventTimestamp,
        result.handled,
        result.summary
      );
    }
    if (result.broadcastNow !== false) {
      broadcastState();
    }
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
