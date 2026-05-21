import {
  BonusChoice,
  DistanceId,
  MatchPhase,
  MatchState,
  ReviewControlFocus,
  SetupControlFocus,
  Team,
  TeamControlMode,
  TurnState,
  WinnerReason,
} from "../types";

export const TEAM_LABELS: Record<Team, string> = {
  red: "RED",
  blue: "BLUE",
};

export const TEAM_ACCENTS: Record<Team, string> = {
  red: "#ff5d5d",
  blue: "#4f9cff",
};

export const DISTANCE_LABELS: Record<DistanceId, string> = {
  near: "近距離 4m-8m",
  middle: "中距離 8m-13m",
  far: "遠距離 13m-15m",
};

export const BONUS_LABELS: Record<BonusChoice, string> = {
  distance: "相手側へ距離点",
  opponentAverage: "自チームへ平均基礎点",
};

export const PHASE_LABELS: Record<MatchPhase, string> = {
  setup: "試合準備",
  selection: "選択中",
  active: "投球中",
  review: "審判判定中",
  finished: "試合終了",
};

export const WINNER_REASON_LABELS: Record<Exclude<WinnerReason, null>, string> = {
  roundedScore: "切り上げ後得点",
  rawScore: "小数点を含む実得点",
  fouls: "反則数",
  disqualification: "失格",
};

export const SETUP_FOCUS_LABELS: Record<SetupControlFocus, string> = {
  duration: "制限時間",
  firstThrowingTeam: "先攻チーム",
  triggerThreshold: "成功判定閾値",
  autoCalibration: "自動キャリブレーション",
  startMatch: "試合開始",
  reset: "リセット",
};

export const TEAM_CONTROL_MODE_LABELS: Record<TeamControlMode, string> = {
  idle: "待機",
  shooter: "投球者選択",
  distance: "距離選択",
  ball: "ボール選択",
  bonus: "追加得点の向き選択",
  done: "確定済み",
};

export const REVIEW_FOCUS_LABELS: Record<ReviewControlFocus, string> = {
  outcome: "結果",
  actualDistance: "実距離",
  foulTeam: "反則",
  disqualifiedTeam: "失格",
  confirm: "確定",
};

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
  const startedAt = state.currentTurn?.startedAt;
  if (state.phase !== "active" || !startedAt) {
    return null;
  }

  const elapsedMs = Date.now() - startedAt;
  return Math.max(0, Math.ceil((state.turnDurationSec * 1000 - elapsedMs) / 1000));
}

export function findPlayerName(state: MatchState, team: Team, playerId: string | null): string {
  if (!playerId) {
    return "未選択";
  }

  return state.teams[team].players.find((player) => player.id === playerId)?.name ?? "不明";
}

export function findBallName(state: MatchState, ballId: string | null): string {
  if (!ballId) {
    return "未選択";
  }

  return state.balls.find((ball) => ball.id === ballId)?.name ?? "不明";
}

export function getTurnSelectionSummary(state: MatchState, turn: TurnState | null) {
  if (!turn) {
    return {
      shooter: "未設定",
      distance: "未設定",
      ball: "未設定",
      bonus: "未設定",
    };
  }

  return {
    shooter: findPlayerName(state, turn.throwingTeam, turn.selection.shooterId),
    distance: turn.selection.distanceId ? DISTANCE_LABELS[turn.selection.distanceId] : "未設定",
    ball: findBallName(state, turn.selection.ballId),
    bonus: turn.selection.bonusChoice ? BONUS_LABELS[turn.selection.bonusChoice] : "未設定",
  };
}

export function getWinnerSummary(reason: WinnerReason): string {
  if (!reason) {
    return "延長戦が必要です";
  }

  return WINNER_REASON_LABELS[reason];
}

export function getRemainingBonusRights(state: MatchState, recipientTeam: Team, roundNumber = state.roundNumber): number {
  const limit = state.teams[recipientTeam].players.length;
  let used = 0;

  for (const turn of state.history) {
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
