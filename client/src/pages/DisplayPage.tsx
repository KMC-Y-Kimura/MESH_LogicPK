import { useEffect, useState } from "react";
import { apiClient, useApiStore } from "../api/client";
import { EventLog } from "../components/EventLog";
import { SetupOverview } from "../components/SetupOverview";
import {
  BONUS_LABELS,
  DISTANCE_LABELS,
  PHASE_LABELS,
  REVIEW_FOCUS_LABELS,
  SETUP_FOCUS_LABELS,
  TEAM_ACCENTS,
  TEAM_LABELS,
  findBallName,
  findPlayerName,
  formatScore,
  getDisplayScore,
  getWinnerSummary,
} from "../lib/match";

export default function DisplayPage() {
  const state = useApiStore((store) => store.state);
  const eventLog = useApiStore((store) => store.eventLog);
  const [, setNow] = useState(Date.now());
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (!state || state.phase !== "active") {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [state?.phase, state?.currentTurn?.startedAt]);

  if (!state) {
    return <CenteredMessage message="接続中..." />;
  }

  const currentTurn = state.currentTurn;
  const remainingSeconds =
    state.phase === "active" && currentTurn?.startedAt
      ? Math.max(0, Math.ceil((state.turnDurationSec * 1000 - (Date.now() - currentTurn.startedAt)) / 1000))
      : null;
  const selectionComplete = Boolean(
    currentTurn?.selection.shooterId &&
      currentTurn?.selection.distanceId &&
      currentTurn?.selection.ballId &&
      currentTurn?.selection.bonusChoice
  );
  const bonusPubliclyVisible = state.phase === "finished" || currentTurn?.outcome !== null;
  const shouldHideLiveButtonDetails =
    state.phase === "selection" || state.phase === "active" || state.phase === "review";
  const shooterName = !currentTurn
    ? "未設定"
    : selectionComplete
      ? findPlayerName(state, currentTurn.throwingTeam, currentTurn.selection.shooterId)
      : "選択完了まで非表示";
  const ballName = !currentTurn
    ? "未設定"
    : selectionComplete
      ? findBallName(state, currentTurn.selection.ballId)
      : "選択完了まで非表示";
  const distanceLabel = !currentTurn
    ? "未設定"
    : selectionComplete
      ? currentTurn.selection.distanceId
        ? DISTANCE_LABELS[currentTurn.selection.distanceId]
        : "未設定"
      : "選択完了まで非表示";
  const bonusLabel = !currentTurn
    ? "未設定"
    : bonusPubliclyVisible
      ? currentTurn.selection.bonusChoice
        ? BONUS_LABELS[currentTurn.selection.bonusChoice]
        : "未設定"
      : "結果確定まで非表示";
  const sensorLabel =
    state.sensor.latestNormalized === null ? "未取得" : `${formatScore(state.sensor.latestNormalized)}%`;
  const lastButtonInput = state.buttonControls.lastInput;

  async function resetMatch() {
    try {
      setActionError("");
      await apiClient.resetMatch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }

  if (state.phase === "setup") {
    return (
      <div
        style={{
          minHeight: "100vh",
          padding: "2rem",
          background:
            "radial-gradient(circle at top, rgba(37,99,235,0.2), transparent 40%), radial-gradient(circle at bottom, rgba(239,68,68,0.2), transparent 40%), #020617",
        }}
      >
        <div
          style={{
            maxWidth: "1480px",
            margin: "0 auto",
            display: "grid",
            gap: "1.5rem",
          }}
        >
          <SetupOverview
            state={state}
            title="Logic PK Overall Screen"
            subtitle="全体モニター用の準備画面です。設定編集は RED 画面で行います。"
            message="現在は試合前です。全体モニターと BLUE モニターには、試合設定とブロック状態を表示します。試合開始後はこの画面がメイン画面へ切り替わります。"
          />
          <EventLog entries={eventLog} maxEntries={12} />
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "2rem",
        background:
          "radial-gradient(circle at top, rgba(37,99,235,0.2), transparent 40%), radial-gradient(circle at bottom, rgba(239,68,68,0.2), transparent 40%), #020617",
      }}
    >
      <div
        style={{
          maxWidth: "1480px",
          margin: "0 auto",
          display: "grid",
          gap: "1.5rem",
        }}
      >
        <section
          style={{
            padding: "1.5rem 2rem",
            borderRadius: "24px",
            background: "rgba(15, 23, 42, 0.95)",
            border: "1px solid #334155",
            display: "grid",
            gridTemplateColumns: "1.15fr 0.85fr",
            gap: "1rem",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: "0.95rem", color: "#93c5fd", fontWeight: 700 }}>
              Logic PK Main Screen
            </div>
            <h1 style={{ fontSize: "2.7rem", marginTop: "0.25rem" }}>
              {PHASE_LABELS[state.phase]}
            </h1>
            <div style={{ marginTop: "0.65rem", color: "#cbd5e1", fontSize: "1.1rem" }}>
              ラウンド {state.roundNumber}
              {currentTurn ? ` / ターン ${currentTurn.turnNumber}` : ""}
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "0.75rem",
              textAlign: "center",
            }}
          >
            <MetricCard label="残り時間" value={remainingSeconds === null ? "−" : `${remainingSeconds}s`} />
            <MetricCard label="センサー" value={sensorLabel} />
            <MetricCard label="成功検知" value={state.sensor.successDetected ? "検知済み" : "未検知"} />
            <MetricCard label="延長戦" value={state.requiresOvertime ? "必要" : "不要"} />
          </div>
        </section>

        {actionError && (
          <section
            style={{
              padding: "1rem 1.25rem",
              borderRadius: "14px",
              border: "1px solid #ef4444",
              background: "rgba(127, 29, 29, 0.35)",
              whiteSpace: "pre-wrap",
            }}
          >
            {actionError}
          </section>
        )}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "1rem",
          }}
        >
          {(["red", "blue"] as const).map((team) => {
            const teamState = state.teams[team];
            return (
              <div
                key={team}
                style={{
                  padding: "1.75rem",
                  borderRadius: "22px",
                  background: `${TEAM_ACCENTS[team]}18`,
                  border: `2px solid ${TEAM_ACCENTS[team]}`,
                }}
              >
                <div style={{ color: TEAM_ACCENTS[team], fontWeight: 700, fontSize: "1rem" }}>
                  {TEAM_LABELS[team]}
                </div>
                <div style={{ fontSize: "2rem", fontWeight: 700, marginTop: "0.35rem" }}>
                  {teamState.name}
                </div>
                <div style={{ marginTop: "1rem", fontSize: "4rem", fontWeight: 800 }}>
                  {getDisplayScore(teamState.rawScore)}
                </div>
                <div style={{ color: "#e2e8f0" }}>実得点 {formatScore(teamState.rawScore)}</div>
                <div style={{ marginTop: "1rem", color: "#cbd5e1", lineHeight: 1.8 }}>
                  <div>平均基礎点: {formatScore(teamState.averageBasePoints)}</div>
                  <div>反則数: {teamState.fouls}</div>
                  <div>失格: {teamState.disqualified ? "あり" : "なし"}</div>
                </div>
              </div>
            );
          })}
        </section>

        <section
          style={{
            padding: "1.5rem 2rem",
            borderRadius: "22px",
            background: "rgba(15, 23, 42, 0.94)",
            border: "1px solid #334155",
          }}
        >
          <h2 style={{ fontSize: "1.4rem", marginBottom: "1rem" }}>現在のターン情報</h2>
          {!currentTurn ? (
            <div style={{ color: "#94a3b8" }}>ターンはまだ作成されていません。</div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "0.9rem",
              }}
            >
              <MetricCard label="投げる側" value={state.teams[currentTurn.throwingTeam].name} />
              <MetricCard label="守る側" value={state.teams[currentTurn.defendingTeam].name} />
              <MetricCard label="投球者" value={shooterName} />
              <MetricCard label="距離" value={distanceLabel} />
              <MetricCard label="ボール" value={ballName} />
              <MetricCard label="追加得点" value={bonusLabel} />
            </div>
          )}
        </section>

        <section
          style={{
            padding: "1.25rem 1.5rem",
            borderRadius: "18px",
            background: "rgba(15, 23, 42, 0.94)",
            border: "1px solid #334155",
          }}
        >
          <h2 style={{ fontSize: "1.2rem", marginBottom: "0.8rem" }}>ボタン操作状態</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "0.8rem",
            }}
          >
            <MetricCard
              label="審判ボタンフォーカス"
              value={
                state.phase === "review"
                  ? REVIEW_FOCUS_LABELS[state.buttonControls.review.focus]
                  : SETUP_FOCUS_LABELS[state.buttonControls.setup.focus]
              }
            />
            <MetricCard
              label="審判ボタン操作"
              value={
                state.phase === "review"
                  ? "単押し=項目移動 / ダブル=値変更 / 長押し=確定"
                  : state.phase === "selection"
                    ? "長押し=ターン開始"
                    : state.phase === "active"
                      ? "長押し=レビューへ"
                      : "単押し/ダブル=項目移動 / 長押し=実行"
              }
            />
            <MetricCard
              label="最後のボタン入力"
              value={
                shouldHideLiveButtonDetails
                  ? "進行中のため非表示"
                  : lastButtonInput
                  ? `${lastButtonInput.buttonId} / ${lastButtonInput.action}`
                  : "まだありません"
              }
            />
            <MetricCard
              label="最後の結果"
              value={
                shouldHideLiveButtonDetails
                  ? "進行中のため非表示"
                  : lastButtonInput
                    ? lastButtonInput.summary
                    : "まだありません"
              }
            />
          </div>
        </section>

        {state.phase === "review" && currentTurn && (
          <section
            style={{
              padding: "1.25rem 1.5rem",
              borderRadius: "18px",
              background: "rgba(245, 158, 11, 0.15)",
              border: "1px solid #f59e0b",
            }}
          >
            <div style={{ fontSize: "1.15rem", fontWeight: 700 }}>審判判定待ち</div>
            <div style={{ marginTop: "0.5rem", color: "#fde68a", lineHeight: 1.7 }}>
              <div>結果候補: {state.buttonControls.review.outcome}</div>
              <div>
                実距離候補:{" "}
                {state.buttonControls.review.actualDistanceId
                  ? DISTANCE_LABELS[state.buttonControls.review.actualDistanceId]
                  : "選択どおり"}
              </div>
              <div>反則: {state.buttonControls.review.foulTeam ?? "なし"}</div>
              <div>失格: {state.buttonControls.review.disqualifiedTeam ?? "なし"}</div>
              <div style={{ marginTop: "0.35rem" }}>
                {currentTurn.notes ?? "成功・失敗・反則・失格の最終判定を待っています。"}
              </div>
            </div>
          </section>
        )}

        {state.phase === "finished" && (
          <section
            style={{
              padding: "1.5rem 2rem",
              borderRadius: "22px",
              background: "rgba(15, 23, 42, 0.94)",
              border: "1px solid #334155",
            }}
          >
            <div style={{ fontSize: "0.95rem", color: "#93c5fd", fontWeight: 700 }}>
              試合結果
            </div>
            <div style={{ fontSize: "2rem", fontWeight: 700, marginTop: "0.35rem" }}>
              {state.winner === "draw"
                ? "延長戦が必要です"
                : `${state.teams[state.winner!].name} の勝ち`}
            </div>
            <div style={{ marginTop: "0.5rem", color: "#cbd5e1" }}>
              判定基準: {getWinnerSummary(state.winnerReason)}
            </div>
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                onClick={() => void resetMatch()}
                style={{
                  border: "none",
                  borderRadius: "999px",
                  padding: "0.85rem 1.25rem",
                  background: "#475569",
                  color: "#f8fafc",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                試合をリセット
              </button>
              <div style={{ color: "#cbd5e1", alignSelf: "center" }}>
                審判ボタンでも `reset` に合わせて長押しするとリセットできます。
              </div>
            </div>
            {state.history.length > 0 && (
              <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
                {state.history.map((turn) => (
                  <div
                    key={`${turn.roundNumber}-${turn.turnNumber}`}
                    style={{
                      padding: "0.95rem 1rem",
                      borderRadius: "14px",
                      background: "#0f172a",
                      border: "1px solid #334155",
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      R{turn.roundNumber} / T{turn.turnNumber} / {state.teams[turn.throwingTeam].name}
                    </div>
                    <div style={{ marginTop: "0.35rem", color: "#cbd5e1", lineHeight: 1.7 }}>
                      <div>投球者: {findPlayerName(state, turn.throwingTeam, turn.selection.shooterId)}</div>
                      <div>
                        距離:{" "}
                        {turn.actualDistanceId
                          ? DISTANCE_LABELS[turn.actualDistanceId]
                          : turn.selection.distanceId
                            ? DISTANCE_LABELS[turn.selection.distanceId]
                            : "未記録"}
                      </div>
                      <div>結果: {turn.outcome ?? "未確定"}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {shouldHideLiveButtonDetails ? (
          <section
            style={{
              padding: "1.25rem 1.5rem",
              borderRadius: "18px",
              background: "rgba(15, 23, 42, 0.94)",
              border: "1px solid #334155",
              color: "#94a3b8",
            }}
          >
            進行中のため、操作ログの詳細は非表示です。
          </section>
        ) : (
          <EventLog entries={eventLog} maxEntries={12} />
        )}
      </div>
    </div>
  );
}

function CenteredMessage({ message }: { message: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#020617",
        color: "#e2e8f0",
        fontSize: "1.6rem",
      }}
    >
      {message}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "1rem 1.15rem",
        borderRadius: "16px",
        background: "#0f172a",
        border: "1px solid #334155",
      }}
    >
      <div style={{ fontSize: "0.82rem", color: "#94a3b8" }}>{label}</div>
      <div style={{ marginTop: "0.35rem", fontSize: "1.15rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}
