import { type CSSProperties } from "react";
import { useApiStore } from "../api/client";
import {
  REVIEW_FOCUS_LABELS,
  TEAM_ACCENTS,
  TEAM_LABELS,
  findPlayerName,
  formatDistanceLabel,
  formatScore,
  getBonusChoiceLabelForTurn,
  getDisplayScore,
  getPhaseDisplayLabel,
  getRemainingBonusRights,
  getRemainingSeconds,
} from "../lib/match";
import { Team } from "../types";

interface TeamPageProps {
  team: Team;
}

const SCOREBOARD_TEAMS: Team[] = ["red", "blue"];

export default function TeamPage({ team }: TeamPageProps) {
  const state = useApiStore((store) => store.state);

  if (!state) {
    return <CenteredMessage message="サーバへ接続中..." />;
  }

  if (state.phase === "setup") {
    return <SetupWaitingPage team={team} />;
  }

  const currentTurn = state.currentTurn;
  const teamState = state.teams[team];
  const accent = TEAM_ACCENTS[team];
  const remainingSeconds = getRemainingSeconds(state);
  const role =
    currentTurn?.throwingTeam === team
      ? "throwing"
      : currentTurn?.defendingTeam === team
        ? "defending"
        : "waiting";
  const teamControl = state.buttonControls.team[team];
  const currentShooter = currentTurn ? findPlayerName(state, currentTurn.throwingTeam, currentTurn.selection.shooterId) : "未設定";
  const currentDistance = currentTurn?.selection.distanceId ? formatDistanceLabel(currentTurn.selection.distanceId) : "未設定";
  const currentBonus =
    currentTurn?.selection.bonusChoice
      ? getBonusChoiceLabelForTurn(state, currentTurn, currentTurn.selection.bonusChoice)
      : "未設定";
  const candidateDistance = formatDistanceLabel(teamControl.candidateDistanceId);
  const candidateBonus =
    currentTurn && teamControl.candidateBonusChoice
      ? getBonusChoiceLabelForTurn(state, currentTurn, teamControl.candidateBonusChoice)
      : "未設定";

  const activeSelectionField =
    state.phase === "draft"
      ? teamControl.mode === "order"
        ? "order"
        : null
      : state.phase === "selection"
        ? role === "throwing" && teamControl.mode === "distance"
          ? "distance"
          : role === "defending" && teamControl.mode === "bonus"
            ? "bonus"
            : null
        : null;

  const showOpponentDistance = !currentTurn
    ? true
    : role !== "defending" || state.phase === "active" || state.phase === "review" || state.phase === "result" || state.phase === "finished";
  const showThrowerBonus = !currentTurn
    ? true
    : role !== "throwing" || state.phase === "active" || state.phase === "review" || state.phase === "result" || state.phase === "finished";

  return (
    <div style={{ minHeight: "100vh", padding: "1.5rem", background: "#111827" }}>
      <div style={{ maxWidth: "1180px", margin: "0 auto", display: "grid", gap: "1rem" }}>
        <section
          style={{
            padding: "1.5rem",
            borderRadius: "22px",
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
              <h1 style={{ fontSize: "2.1rem", marginTop: "0.25rem" }}>{teamState.name}</h1>
              <div style={{ marginTop: "0.55rem", color: "#cbd5e1" }}>
                現在フェーズ: {getPhaseDisplayLabel(state)}
              </div>
            </div>
            <div style={{ textAlign: "right", color: "#cbd5e1", lineHeight: 1.8 }}>
              <div>自分の役割: {role === "throwing" ? "投げる側" : role === "defending" ? "投げない側" : "待機"}</div>
              <div>残り時間: {remainingSeconds === null ? "−" : `${remainingSeconds} 秒`}</div>
            </div>
          </div>

          <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
            {SCOREBOARD_TEAMS.map((scoreTeam) => {
              const scoreTeamState = state.teams[scoreTeam];
              return (
                <ScoreCard
                  key={scoreTeam}
                  team={scoreTeam}
                  teamName={scoreTeamState.name}
                  score={scoreTeamState.rawScore}
                  fouls={scoreTeamState.fouls}
                  disqualified={scoreTeamState.disqualified}
                />
              );
            })}
          </div>
        </section>

        {state.phase === "draft" && (
          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>投球順決定</h2>
            <div style={{ color: "#cbd5e1", lineHeight: 1.8, marginTop: "0.7rem" }}>
              <div>各チーム 5 分以内に投球順を決めます。</div>
              <div>{teamState.name} は ボタン1 で候補送り、ボタン2 で追加です。</div>
              <div>両チームが決まり次第、最初のターン選択へ自動で進みます。</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "1rem" }}>
              <OrderCard
                title="自分たちの投球順"
                highlight
                active={activeSelectionField === "order"}
                currentLabel={teamControl.candidatePlayerId ? findPlayerName(state, team, teamControl.candidatePlayerId) : "未選択"}
                players={state.teams[team].throwOrderPlayerIds.map((playerId) => findPlayerName(state, team, playerId))}
              />
              <OrderCard
                title="相手チームの投球順"
                currentLabel="非表示"
                players={state.teams[otherTeam(team)].throwOrderPlayerIds.map((_, index) => `P${index + 1} 確定`)}
              />
            </div>
          </section>
        )}

        {currentTurn && (
          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>現在ターン</h2>
            <div style={{ marginTop: "0.75rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
              <SummaryCard
                title="投球者"
                value={currentShooter}
                accent={accent}
              />
              <SummaryCard
                title="距離"
                value={
                  activeSelectionField === "distance"
                    ? candidateDistance
                    : showOpponentDistance
                      ? currentDistance
                      : "投球開始まで非表示"
                }
                active={activeSelectionField === "distance"}
                accent={accent}
              />
              <SummaryCard
                title="追加得点権"
                value={
                  activeSelectionField === "bonus"
                    ? candidateBonus
                    : showThrowerBonus
                      ? currentBonus
                      : "投球開始まで非表示"
                }
                active={activeSelectionField === "bonus"}
                accent={accent}
              />
            </div>
          </section>
        )}

        {state.phase === "selection" && currentTurn && (
          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>ターン選択</h2>
            <div style={{ color: "#cbd5e1", lineHeight: 1.8, marginTop: "0.7rem" }}>
              {role === "throwing" && <div>{teamState.name} は距離を選んでください。</div>}
              {role === "defending" && (
                <>
                  <div>{teamState.name} は使う追加得点権を選んでください。</div>
                  <div>
                    距離点権 残り {getRemainingBonusRights(state, currentTurn.throwingTeam, currentTurn.isOvertime)} /
                    平均基礎点権 残り {getRemainingBonusRights(state, currentTurn.defendingTeam, currentTurn.isOvertime)}
                  </div>
                </>
              )}
              {role === "waiting" && <div>相手チームの選択が進行中です。</div>}
              <div>10 秒経過で現在カーソルの内容が自動確定されます。</div>
            </div>
          </section>
        )}

        {state.phase === "confirmation" && currentTurn && (
          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>選択確認</h2>
            <div style={{ color: "#cbd5e1", lineHeight: 1.8, marginTop: "0.7rem" }}>
              <div>審判が長押しすると投球開始です。</div>
              <div>投げる側には、追加得点権の向きはまだ見えません。</div>
            </div>
          </section>
        )}

        {state.phase === "active" && currentTurn && (
          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>投球中</h2>
            <div style={{ color: "#cbd5e1", lineHeight: 1.8, marginTop: "0.7rem" }}>
              <div>投球時間は 20 秒です。</div>
              <div>センサー判定: {state.sensor.successDetected ? "成功検知済み" : "まだ成功検知なし"}</div>
              <div>審判長押しで確定、審判ダブルクリックで詳細判定に入ります。</div>
            </div>
          </section>
        )}

        {state.phase === "review" && (
          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>審判判定</h2>
            <div style={{ color: "#cbd5e1", lineHeight: 1.8, marginTop: "0.7rem" }}>
              <div>審判単押し: 項目移動</div>
              <div>審判ダブルクリック: 値変更</div>
              <div>審判長押し: 確定</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem", marginTop: "1rem" }}>
              <ReviewCard
                active={state.buttonControls.review.focus === "outcome"}
                label={REVIEW_FOCUS_LABELS.outcome}
                value={state.buttonControls.review.outcome}
              />
              <ReviewCard
                active={state.buttonControls.review.focus === "actualDistance"}
                label={REVIEW_FOCUS_LABELS.actualDistance}
                value={
                  state.buttonControls.review.actualDistanceId === null
                    ? "選択どおり"
                    : formatDistanceLabel(state.buttonControls.review.actualDistanceId)
                }
              />
              <ReviewCard
                active={state.buttonControls.review.focus === "foulTeam"}
                label={REVIEW_FOCUS_LABELS.foulTeam}
                value={
                  state.buttonControls.review.foulTeam
                    ? state.teams[state.buttonControls.review.foulTeam].name
                    : "なし"
                }
              />
              <ReviewCard
                active={state.buttonControls.review.focus === "disqualifiedTeam"}
                label={REVIEW_FOCUS_LABELS.disqualifiedTeam}
                value={
                  state.buttonControls.review.disqualifiedTeam
                    ? state.teams[state.buttonControls.review.disqualifiedTeam].name
                    : "なし"
                }
              />
            </div>
          </section>
        )}

        {state.phase === "result" && currentTurn && (
          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>ターン結果</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem", marginTop: "1rem" }}>
              <SummaryCard title="投球者" value={currentShooter} accent={accent} />
              <SummaryCard title="結果" value={currentTurn.outcome ?? "未確定"} accent={accent} />
              <SummaryCard title="使用した権利" value={currentTurn.selection.bonusChoice ? getBonusChoiceLabelForTurn(state, currentTurn, currentTurn.selection.bonusChoice) : "未設定"} accent={accent} />
            </div>
            <div style={{ marginTop: "1rem", color: "#cbd5e1", lineHeight: 1.8 }}>
              {currentTurn.scoreBreakdown ? (
                <>
                  <div>投球者基礎点: {formatScore(currentTurn.scoreBreakdown.shooterBasePoints)}</div>
                  <div>距離点: {formatScore(currentTurn.scoreBreakdown.distancePoints)}</div>
                  <div>平均基礎点: {formatScore(currentTurn.scoreBreakdown.opponentAveragePoints)}</div>
                  <div>
                    RED +{formatScore(currentTurn.scoreBreakdown.redDelta)} / BLUE +{formatScore(currentTurn.scoreBreakdown.blueDelta)}
                  </div>
                </>
              ) : (
                <div>今回は加点なしです。</div>
              )}
              {currentTurn.foulTeam && <div>反則: {state.teams[currentTurn.foulTeam].name}</div>}
              {currentTurn.disqualifiedTeam && <div>失格: {state.teams[currentTurn.disqualifiedTeam].name}</div>}
              <div>審判長押しで次のターンへ進みます。</div>
            </div>
          </section>
        )}

        {state.phase === "finished" && (
          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>試合結果</h2>
            <div style={{ marginTop: "0.8rem", fontSize: "1.8rem", fontWeight: 700 }}>
              {state.winner === "draw"
                ? "延長戦が必要です"
                : `${state.teams[state.winner!].name} の勝ち`}
            </div>
            <div style={{ marginTop: "0.6rem", color: "#cbd5e1" }}>
              {state.requiresOvertime
                ? "審判長押しで延長戦を開始できます。"
                : "次の試合はリセット後に setup 画面から始めます。"}
            </div>
          </section>
        )}

        <section
          style={{
            padding: "1.1rem 1.25rem",
            borderRadius: "18px",
            background: "rgba(15, 23, 42, 0.95)",
            border: "1px solid #334155",
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <a href="/team/red" style={linkStyle}>
            RED 画面
          </a>
          <a href="/team/blue" style={linkStyle}>
            BLUE 画面
          </a>
          <a href="/score" style={linkStyle}>
            スマホ用スコア
          </a>
        </section>
      </div>
    </div>
  );
}

function SetupWaitingPage({ team }: { team: Team }) {
  const state = useApiStore((store) => store.state);

  if (!state) {
    return <CenteredMessage message="サーバへ接続中..." />;
  }

  return (
    <div style={{ minHeight: "100vh", padding: "2rem", background: "#111827" }}>
      <div style={{ maxWidth: "1080px", margin: "0 auto", display: "grid", gap: "1rem" }}>
        <section style={{ ...panelStyle, border: `1px solid ${TEAM_ACCENTS[team]}` }}>
          <div style={{ color: TEAM_ACCENTS[team], fontWeight: 700 }}>{TEAM_LABELS[team]} TEAM</div>
          <h1 style={{ fontSize: "2rem", marginTop: "0.35rem" }}>試合準備中</h1>
          <div style={{ marginTop: "0.75rem", color: "#cbd5e1", lineHeight: 1.8 }}>
            <div>RED 画面で設定を行い、開始後はこの画面がチーム画面に切り替わります。</div>
            <div>固定時間: 投球順決定 5 分 / ターン選択 10 秒 / 投球 20 秒</div>
          </div>
        </section>
        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          {SCOREBOARD_TEAMS.map((scoreTeam) => {
            const teamState = state.teams[scoreTeam];
            return (
              <ScoreCard
                key={scoreTeam}
                team={scoreTeam}
                teamName={teamState.name}
                score={teamState.rawScore}
                fouls={teamState.fouls}
                disqualified={teamState.disqualified}
              />
            );
          })}
        </section>
      </div>
    </div>
  );
}

function otherTeam(team: Team): Team {
  return team === "red" ? "blue" : "red";
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

function SummaryCard({
  title,
  value,
  active = false,
  accent = "#60a5fa",
}: {
  title: string;
  value: string;
  active?: boolean;
  accent?: string;
}) {
  return (
    <div
      style={{
        padding: "1rem 1.15rem",
        borderRadius: "16px",
        background: active ? `${accent}22` : "#172033",
        border: `1px solid ${active ? accent : "#334155"}`,
      }}
    >
      <div style={{ fontSize: "0.82rem", color: active ? accent : "#94a3b8", fontWeight: active ? 700 : 400 }}>
        {active ? `▶ ${title}` : title}
      </div>
      <div style={{ marginTop: "0.38rem", fontSize: "1.1rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function OrderCard({
  title,
  currentLabel,
  players,
  highlight = false,
  active = false,
}: {
  title: string;
  currentLabel: string;
  players: string[];
  highlight?: boolean;
  active?: boolean;
}) {
  return (
    <div
      style={{
        padding: "1rem 1.1rem",
        borderRadius: "18px",
        background: highlight ? "rgba(59, 130, 246, 0.14)" : "#172033",
        border: `1px solid ${active ? "#93c5fd" : "#334155"}`,
      }}
    >
      <div style={{ color: "#94a3b8", fontSize: "0.82rem" }}>{title}</div>
      <div style={{ marginTop: "0.35rem", fontWeight: 700 }}>
        {active ? `▶ 現在候補: ${currentLabel}` : `現在候補: ${currentLabel}`}
      </div>
      <div style={{ marginTop: "0.8rem", display: "grid", gap: "0.45rem" }}>
        {players.length === 0 ? (
          <div style={{ color: "#94a3b8" }}>まだ確定していません</div>
        ) : (
          players.map((player, index) => (
            <div key={`${player}-${index}`} style={{ padding: "0.7rem 0.8rem", borderRadius: "12px", background: "#0f172a", border: "1px solid #334155" }}>
              {index + 1}. {player}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ScoreCard({
  team,
  teamName,
  score,
  fouls,
  disqualified,
}: {
  team: Team;
  teamName: string;
  score: number;
  fouls: number;
  disqualified: boolean;
}) {
  return (
    <div
      style={{
        padding: "1rem 1.2rem",
        borderRadius: "16px",
        background: `${TEAM_ACCENTS[team]}16`,
        border: `1px solid ${TEAM_ACCENTS[team]}`,
      }}
    >
      <div style={{ fontSize: "0.82rem", color: TEAM_ACCENTS[team], fontWeight: 700 }}>
        {TEAM_LABELS[team]}
      </div>
      <div style={{ marginTop: "0.35rem", fontSize: "1rem", fontWeight: 700 }}>{teamName}</div>
      <div style={{ marginTop: "0.45rem", fontSize: "2rem", fontWeight: 800 }}>
        {getDisplayScore(score)}
      </div>
      <div style={{ color: "#cbd5e1" }}>
        実得点 {formatScore(score)} / 反則 {fouls} / 失格 {disqualified ? "あり" : "なし"}
      </div>
    </div>
  );
}

function ReviewCard({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div
      style={{
        padding: "1rem 1.15rem",
        borderRadius: "16px",
        background: active ? "rgba(124, 58, 237, 0.2)" : "#172033",
        border: `1px solid ${active ? "#a78bfa" : "#334155"}`,
      }}
    >
      <div style={{ fontSize: "0.82rem", color: "#c4b5fd" }}>{label}</div>
      <div style={{ marginTop: "0.35rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const panelStyle: CSSProperties = {
  padding: "1.35rem 1.45rem",
  borderRadius: "22px",
  background: "rgba(15, 23, 42, 0.95)",
  border: "1px solid #334155",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "1.3rem",
  margin: 0,
};

const linkStyle: CSSProperties = {
  color: "#93c5fd",
  textDecoration: "none",
  fontWeight: 700,
};
