import { useState, type CSSProperties } from "react";
import { apiClient, useApiStore } from "../api/client";
import { SetupOverview } from "../components/SetupOverview";
import {
  BONUS_LABELS,
  DISTANCE_LABELS,
  PHASE_LABELS,
  TEAM_CONTROL_MODE_LABELS,
  TEAM_ACCENTS,
  TEAM_LABELS,
  findBallName,
  findPlayerName,
  formatScore,
  getDisplayScore,
  getRemainingBonusRights,
} from "../lib/match";
import { DistanceId, Team } from "../types";

const DISTANCE_ORDER: DistanceId[] = ["near", "middle", "far"];

interface TeamPageProps {
  team: Team;
}

export default function TeamPage({ team }: TeamPageProps) {
  const state = useApiStore((store) => store.state);
  const [error, setError] = useState("");

  if (!state) {
    return <CenteredMessage message="サーバへ接続中..." />;
  }

  const accent = TEAM_ACCENTS[team];
  const teamState = state.teams[team];

  if (state.phase === "setup") {
    return (
      <div style={{ minHeight: "100vh", padding: "2rem", background: "#111827" }}>
        <div
          style={{
            maxWidth: "1080px",
            margin: "0 auto",
            display: "grid",
            gap: "1.5rem",
          }}
        >
          <SetupOverview
            state={state}
            title={`${TEAM_LABELS[team]} Team Screen`}
            subtitle={
              team === "red"
                ? "RED 画面は setup 中に編集画面へ切り替わります。"
                : "BLUE 画面は setup 中は閲覧専用です。"
            }
            message={
              team === "red"
                ? "このルートは試合開始前なら管理画面へ、試合開始後は RED チーム画面へ切り替わります。"
                : "設定内容は RED 画面で編集します。BLUE 側では試合前にルール、メンバー、ボール構成を確認してください。"
            }
            accent={accent}
            emphasizeTeam={team}
          />
          <section
            style={{
              padding: "1.25rem 1.5rem",
              borderRadius: "18px",
              background: "rgba(15, 23, 42, 0.95)",
              border: "1px solid #334155",
            }}
          >
            <div style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.7rem" }}>
              このモニターの使い方
            </div>
            <div style={{ color: "#cbd5e1", lineHeight: 1.8 }}>
              <div>試合開始後、この画面は {teamState.name} の選択画面になります。</div>
              <div>{teamState.name} 側はボタン1で候補送り、ボタン2で確定します。</div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  const currentTurn = state.currentTurn;
  const role =
    currentTurn?.throwingTeam === team
      ? "throwing"
      : currentTurn?.defendingTeam === team
        ? "defending"
        : "waiting";

  const canSelect = state.phase === "selection" && currentTurn !== null;
  const selectionComplete = Boolean(
    currentTurn?.selection.shooterId &&
      currentTurn?.selection.distanceId &&
      currentTurn?.selection.ballId &&
      currentTurn?.selection.bonusChoice
  );
  const hideOpponentSelections = Boolean(currentTurn) && !selectionComplete;
  const bonusPubliclyVisible = state.phase === "finished" || currentTurn?.outcome !== null;
  const shouldHideLiveButtonDetails =
    state.phase === "selection" || state.phase === "active" || state.phase === "review";
  const hiddenOpponentLabel = "相手の選択完了まで非表示";
  const hiddenBonusLabel = "結果確定まで非表示";
  const selectedShooter = !currentTurn
    ? "未設定"
    : role === "throwing" || !hideOpponentSelections
      ? findPlayerName(state, currentTurn.throwingTeam, currentTurn.selection.shooterId)
      : hiddenOpponentLabel;
  const selectedBall = !currentTurn
    ? "未設定"
    : role === "defending" || !hideOpponentSelections
      ? findBallName(state, currentTurn.selection.ballId)
      : hiddenOpponentLabel;
  const selectedDistance = !currentTurn
    ? "未設定"
    : role === "throwing" || !hideOpponentSelections
      ? currentTurn.selection.distanceId
        ? DISTANCE_LABELS[currentTurn.selection.distanceId]
        : "未設定"
      : hiddenOpponentLabel;
  const selectedBonus = !currentTurn
    ? "未設定"
    : role === "defending" && !selectionComplete
      ? currentTurn.selection.bonusChoice
        ? BONUS_LABELS[currentTurn.selection.bonusChoice]
        : "未設定"
      : bonusPubliclyVisible
        ? currentTurn.selection.bonusChoice
          ? BONUS_LABELS[currentTurn.selection.bonusChoice]
          : "未設定"
        : hiddenBonusLabel;
  const buttonControl = state.buttonControls.team[team];
  const candidateLabel =
    buttonControl.mode === "shooter"
      ? findPlayerName(state, team, buttonControl.candidatePlayerId)
      : buttonControl.mode === "distance"
        ? buttonControl.candidateDistanceId
          ? DISTANCE_LABELS[buttonControl.candidateDistanceId]
          : "未設定"
        : buttonControl.mode === "ball"
          ? findBallName(state, buttonControl.candidateBallId)
          : buttonControl.mode === "bonus"
            ? buttonControl.candidateBonusChoice
              ? BONUS_LABELS[buttonControl.candidateBonusChoice]
              : "未設定"
            : "なし";
  const throwingBonusRights = currentTurn ? getRemainingBonusRights(state, currentTurn.throwingTeam) : 0;
  const defendingBonusRights = currentTurn ? getRemainingBonusRights(state, currentTurn.defendingTeam) : 0;

  async function runAction(action: () => Promise<unknown>) {
    try {
      setError("");
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  }

  return (
    <div style={{ minHeight: "100vh", padding: "2rem", background: "#111827" }}>
      <div
        style={{
          maxWidth: "1080px",
          margin: "0 auto",
          display: "grid",
          gap: "1.5rem",
        }}
      >
        <section
          style={{
            padding: "1.5rem",
            borderRadius: "18px",
            border: `2px solid ${accent}`,
            background: "rgba(15, 23, 42, 0.95)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ color: accent, fontSize: "0.9rem", fontWeight: 700 }}>
                {TEAM_LABELS[team]} TEAM
              </div>
              <h1 style={{ fontSize: "2.2rem", marginTop: "0.25rem" }}>{teamState.name}</h1>
              <div style={{ marginTop: "0.5rem", color: "#cbd5e1" }}>
                現在フェーズ: {PHASE_LABELS[state.phase]}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#94a3b8", fontSize: "0.9rem" }}>現在得点</div>
              <div style={{ fontSize: "2.2rem", fontWeight: 700 }}>
                {getDisplayScore(teamState.rawScore)}
              </div>
              <div style={{ color: "#cbd5e1" }}>実得点 {formatScore(teamState.rawScore)}</div>
            </div>
          </div>
          <div
            style={{
              marginTop: "1rem",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "0.75rem",
            }}
          >
            <StatusPill label="ラウンド" value={String(state.roundNumber)} />
            <StatusPill
              label="反則数"
              value={String(teamState.fouls)}
            />
            <StatusPill
              label="平均基礎点"
              value={formatScore(teamState.averageBasePoints)}
            />
            <StatusPill
              label="自分の役割"
              value={
                role === "throwing" ? "投げる側" : role === "defending" ? "守る側" : "待機"
              }
            />
          </div>
        </section>

        {error && (
          <section
            style={{
              padding: "1rem 1.25rem",
              borderRadius: "14px",
              border: "1px solid #ef4444",
              background: "rgba(127, 29, 29, 0.35)",
              whiteSpace: "pre-wrap",
            }}
          >
            {error}
          </section>
        )}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "1rem",
          }}
        >
          <SummaryCard title="投球者" value={selectedShooter} />
          <SummaryCard title="距離" value={selectedDistance} />
          <SummaryCard title="ボール" value={selectedBall} />
          <SummaryCard title="追加得点" value={selectedBonus} />
        </section>

        <section
          style={{
            padding: "1.5rem",
            borderRadius: "18px",
            background: "rgba(15, 23, 42, 0.95)",
            border: "1px solid #334155",
          }}
        >
          <h2 style={{ fontSize: "1.2rem", marginBottom: "0.75rem" }}>ボタン操作状態</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "0.75rem",
            }}
          >
            <SummaryCard title="現在モード" value={TEAM_CONTROL_MODE_LABELS[buttonControl.mode]} />
            <SummaryCard title="候補" value={candidateLabel} />
            <SummaryCard
              title="操作"
              value={
                buttonControl.mode === "idle"
                  ? "待機"
                  : buttonControl.mode === "done"
                    ? "ボタン2=やり直し"
                    : "ボタン1=次へ / ボタン2=確定"
              }
            />
          </div>
          {state.buttonControls.lastInput &&
            (shouldHideLiveButtonDetails ? (
              <div style={{ marginTop: "0.9rem", color: "#94a3b8", lineHeight: 1.7 }}>
                進行中のため、ボタン入力の詳細は非表示です。
              </div>
            ) : (
              <div style={{ marginTop: "0.9rem", color: "#cbd5e1", lineHeight: 1.7 }}>
                最後のボタン入力: {state.buttonControls.lastInput.buttonId} / {state.buttonControls.lastInput.action}
                {" / "}
                {state.buttonControls.lastInput.summary}
              </div>
            ))}
        </section>

        <section
          style={{
            padding: "1.5rem",
            borderRadius: "18px",
            background: "rgba(15, 23, 42, 0.95)",
            border: "1px solid #334155",
          }}
        >
          <h2 style={{ fontSize: "1.3rem", marginBottom: "0.75rem" }}>この画面で行う操作</h2>
          <div style={{ color: "#cbd5e1", lineHeight: 1.8 }}>
            {role === "throwing" && "投げる側です。投球者と距離を選択してください。"}
            {role === "defending" && "守る側です。ボールと追加得点の向きを選択してください。権利が 0 の向きは選べません。"}
            {role === "waiting" &&
              "現在はこのチームの選択ターンではありません。全体画面または審判画面の指示を待ってください。"}
          </div>
          {!canSelect && (
            <div style={{ marginTop: "0.75rem", color: "#fbbf24" }}>
              選択操作は `選択中` フェーズでのみ受け付けます。
            </div>
          )}
        </section>

        {role === "throwing" && currentTurn && (
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1fr",
              gap: "1rem",
            }}
          >
            <div style={selectionPanelStyle}>
              <h2 style={panelTitleStyle}>投球者を選ぶ</h2>
              <div style={selectionGridStyle}>
                {state.teams[team].players.map((player) => {
                  const selected = currentTurn.selection.shooterId === player.id;
                  const disabled = !canSelect || player.hasActedInRound;
                  return (
                    <button
                      key={player.id}
                      onClick={() => runAction(() => apiClient.selectShooter(player.id))}
                      disabled={disabled}
                      style={choiceButtonStyle(selected, accent, disabled)}
                    >
                      <div style={{ fontWeight: 700 }}>{player.name}</div>
                      <div style={{ fontSize: "0.9rem", color: "#cbd5e1" }}>
                        基礎点 {player.basePoints}
                      </div>
                      {player.hasActedInRound && (
                        <div style={{ fontSize: "0.8rem", color: "#fca5a5" }}>このラウンドで投球済み</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={selectionPanelStyle}>
              <h2 style={panelTitleStyle}>距離を選ぶ</h2>
              <div style={selectionGridStyle}>
                {DISTANCE_ORDER.map((distanceId) => {
                  const selected = currentTurn.selection.distanceId === distanceId;
                  return (
                    <button
                      key={distanceId}
                      onClick={() => runAction(() => apiClient.selectDistance(distanceId))}
                      disabled={!canSelect}
                      style={choiceButtonStyle(selected, accent, !canSelect)}
                    >
                      {DISTANCE_LABELS[distanceId]}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {role === "defending" && currentTurn && (
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "1.1fr 1fr",
              gap: "1rem",
            }}
          >
            <div style={selectionPanelStyle}>
              <h2 style={panelTitleStyle}>ボールを選ぶ</h2>
              <div style={selectionGridStyle}>
                {state.balls.map((ball) => {
                  const selected = currentTurn.selection.ballId === ball.id;
                  const disabled = !canSelect || ball.remaining[team] <= 0;
                  return (
                    <button
                      key={ball.id}
                      onClick={() => runAction(() => apiClient.selectBall(ball.id))}
                      disabled={disabled}
                      style={choiceButtonStyle(selected, accent, disabled)}
                    >
                      <div style={{ fontWeight: 700 }}>{ball.name}</div>
                      <div style={{ fontSize: "0.9rem", color: "#cbd5e1" }}>
                        自チーム残り {ball.remaining[team]} / 初期 {ball.initialCount[team]}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={selectionPanelStyle}>
              <h2 style={panelTitleStyle}>追加得点の向き</h2>
              <div style={{ color: "#cbd5e1", lineHeight: 1.8 }}>
                自チームへ平均基礎点: 残り {defendingBonusRights}
                <br />
                相手側へ距離点: 残り {throwingBonusRights}
              </div>
              <div style={{ ...selectionGridStyle, marginTop: "0.85rem" }}>
                {(["opponentAverage", "distance"] as const).map((bonusChoice) => {
                  const selected = currentTurn.selection.bonusChoice === bonusChoice;
                  const remaining =
                    bonusChoice === "opponentAverage" ? defendingBonusRights : throwingBonusRights;
                  const disabled = !canSelect || remaining <= 0;
                  return (
                    <button
                      key={bonusChoice}
                      onClick={() => runAction(() => apiClient.selectBonus(bonusChoice))}
                      disabled={disabled}
                      style={choiceButtonStyle(selected, accent, disabled)}
                    >
                      <div>{BONUS_LABELS[bonusChoice]}</div>
                      <div style={{ fontSize: "0.85rem", color: "#cbd5e1" }}>残り {remaining}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        <section
          style={{
            padding: "1.25rem 1.5rem",
            borderRadius: "18px",
            background: "rgba(15, 23, 42, 0.95)",
            border: "1px solid #334155",
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <a href="/" style={linkStyle}>
            ホーム画面
          </a>
          {state.phase === "finished" && team === "red" && (
            <button
              onClick={() => runAction(() => apiClient.resetMatch())}
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
          )}
        </section>
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
        background: "#0f172a",
        color: "#e2e8f0",
        fontSize: "1.4rem",
      }}
    >
      {message}
    </div>
  );
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "0.9rem 1rem",
        borderRadius: "14px",
        background: "#172033",
        border: "1px solid #334155",
      }}
    >
      <div style={{ color: "#94a3b8", fontSize: "0.8rem" }}>{label}</div>
      <div style={{ marginTop: "0.35rem", fontSize: "1.05rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <div
      style={{
        padding: "1rem 1.2rem",
        borderRadius: "16px",
        background: "#172033",
        border: "1px solid #334155",
      }}
    >
      <div style={{ fontSize: "0.82rem", color: "#94a3b8" }}>{title}</div>
      <div style={{ marginTop: "0.4rem", fontSize: "1.1rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const selectionPanelStyle: CSSProperties = {
  padding: "1.5rem",
  borderRadius: "18px",
  background: "rgba(15, 23, 42, 0.95)",
  border: "1px solid #334155",
};

const panelTitleStyle: CSSProperties = {
  fontSize: "1.2rem",
  marginBottom: "0.9rem",
};

const selectionGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "0.75rem",
};

function choiceButtonStyle(selected: boolean, accent: string, disabled: boolean): CSSProperties {
  return {
    padding: "1rem",
    borderRadius: "14px",
    border: `1px solid ${selected ? accent : "#334155"}`,
    background: selected ? `${accent}22` : "#0f172a",
    color: "#f8fafc",
    textAlign: "left",
    opacity: disabled ? 0.55 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

const linkStyle: CSSProperties = {
  color: "#93c5fd",
  textDecoration: "none",
  fontWeight: 700,
};
