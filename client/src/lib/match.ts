import {
  BonusChoice,
  MatchPhase,
  MatchState,
  ReviewControlFocus,
  SetupControlFocus,
  Team,
  TeamControlMode,
  TurnState,
  WinnerReason,
} from "../types";

export const DISTANCE_MIN_METER = 1;
export const DISTANCE_MAX_METER = 15;
export const DISTANCE_OPTIONS = Array.from(
  { length: DISTANCE_MAX_METER - DISTANCE_MIN_METER + 1 },
  (_, index) => DISTANCE_MIN_METER + index
);

export const TEAM_LABELS: Record<Team, string> = {
  red: "RED",
  blue: "BLUE",
};

export const TEAM_ACCENTS: Record<Team, string> = {
  red: "#ff5d5d",
  blue: "#4f9cff",
};

export const BONUS_LABELS: Record<BonusChoice, string> = {
  distance: "投げる側へ距離点",
  opponentAverage: "守る側へ平均基礎点",
};

export const PHASE_LABELS: Record<MatchPhase, string> = {
  setup: "試合準備",
  draft: "投球順決定",
  selection: "ターン選択",
  confirmation: "選択確認",
  active: "投球中",
  review: "審判判定中",
  result: "ターン結果",
  finished: "試合終了",
};

export const WINNER_REASON_LABELS: Record<Exclude<WinnerReason, null>, string> = {
  roundedScore: "切り上げ後得点",
  rawScore: "実得点",
  fouls: "反則数",
  disqualification: "失格",
};

export const SETUP_FOCUS_LABELS: Record<SetupControlFocus, string> = {
  firstThrowingTeam: "先攻チーム",
  triggerThreshold: "成功判定閾値",
  autoCalibration: "自動キャリブレーション",
  startMatch: "試合開始",
  reset: "リセット",
};

export const TEAM_CONTROL_MODE_LABELS: Record<TeamControlMode, string> = {
  idle: "待機",
  order: "投球順選択",
  distance: "距離選択",
  bonus: "追加得点権選択",
  done: "確定済み",
};

export const REVIEW_FOCUS_LABELS: Record<ReviewControlFocus, string> = {
  outcome: "結果",
  actualDistance: "実距離",
  foulTeam: "反則",
  disqualifiedTeam: "失格",
  confirm: "確定",
};

export function formatDistanceLabel(distance: number | null): string {
  return distance === null ? "未設定" : `${distance}m`;
}

export function formatScore(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(2).replace(/\.?0+$/, "");
}

export function getDisplayScore(rawScore: number): number {
  return Math.ceil(rawScore);
}

export function getRemainingSeconds(state: MatchState): number | null {
  if (!state.phaseStartedAt) {
    return null;
  }

  let durationSec: number | null = null;
  if (state.phase === "draft") {
    durationSec = state.draftDurationSec;
  } else if (state.phase === "selection") {
    durationSec = state.selectionDurationSec;
  } else if (state.phase === "active") {
    durationSec = state.activeDurationSec;
  }

  if (durationSec === null) {
    return null;
  }

  const elapsedMs = Date.now() - state.phaseStartedAt;
  return Math.max(0, Math.ceil((durationSec * 1000 - elapsedMs) / 1000));
}

export function findPlayerName(state: MatchState, team: Team, playerId: string | null): string {
  if (!playerId) {
    return "未設定";
  }

  return state.teams[team].players.find((player) => player.id === playerId)?.name ?? "不明";
}

export function getWinnerSummary(reason: WinnerReason): string {
  if (!reason) {
    return "延長戦が必要です";
  }

  return WINNER_REASON_LABELS[reason];
}

export function getPhaseDisplayLabel(state: MatchState): string {
  if (state.isOvertime && state.phase !== "setup" && state.phase !== "finished") {
    return `延長戦 / ${PHASE_LABELS[state.phase]}`;
  }

  return PHASE_LABELS[state.phase];
}

export function getRemainingBonusRights(
  state: MatchState,
  recipientTeam: Team,
  isOvertime = state.isOvertime
): number {
  const limit = state.teams[recipientTeam].players.length;
  let used = 0;

  for (const turn of state.history) {
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

export function getBonusRecipientTeam(turn: TurnState, choice: BonusChoice): Team {
  return choice === "distance" ? turn.throwingTeam : turn.defendingTeam;
}

export function getBonusUsageTeam(turn: TurnState, choice: BonusChoice): Team {
  return choice === "distance" ? turn.throwingTeam : turn.defendingTeam;
}

export function getBonusChoiceLabelForTurn(state: MatchState, turn: TurnState, choice: BonusChoice): string {
  const recipientTeam = getBonusRecipientTeam(turn, choice);
  return choice === "distance"
    ? `${state.teams[recipientTeam].name} に距離点`
    : `${state.teams[recipientTeam].name} に平均基礎点`;
}
