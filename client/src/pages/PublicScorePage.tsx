import { useApiStore } from "../api/client";
import {
  TEAM_ACCENTS,
  TEAM_LABELS,
  formatScore,
  getDisplayScore,
  getPhaseDisplayLabel,
  getRemainingSeconds,
} from "../lib/match";
import { Team } from "../types";

const SCORE_TEAMS: Team[] = ["red", "blue"];

export default function PublicScorePage() {
  const state = useApiStore((store) => store.state);

  if (!state) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#020617",
          color: "#e2e8f0",
          fontSize: "1.25rem",
        }}
      >
        スコアを読み込み中...
      </div>
    );
  }

  const remainingSeconds = getRemainingSeconds(state);

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "1rem",
        background:
          "radial-gradient(circle at top, rgba(59,130,246,0.18), transparent 35%), radial-gradient(circle at bottom, rgba(239,68,68,0.16), transparent 35%), #020617",
        color: "#f8fafc",
      }}
    >
      <div
        style={{
          maxWidth: "960px",
          margin: "0 auto",
          display: "grid",
          gap: "1rem",
        }}
      >
        <section
          style={{
            padding: "1.25rem",
            borderRadius: "22px",
            background: "rgba(15, 23, 42, 0.92)",
            border: "1px solid #334155",
            textAlign: "center",
          }}
        >
          <div style={{ color: "#93c5fd", fontWeight: 700, letterSpacing: "0.08em" }}>
            LIVE SCORE
          </div>
          <h1 style={{ fontSize: "2rem", marginTop: "0.35rem" }}>{getPhaseDisplayLabel(state)}</h1>
          <div style={{ marginTop: "0.6rem", color: "#cbd5e1" }}>
            {remainingSeconds === null ? "待機中" : `残り ${remainingSeconds} 秒`}
          </div>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "1rem",
          }}
        >
          {SCORE_TEAMS.map((team) => {
            const teamState = state.teams[team];
            return (
              <article
                key={team}
                style={{
                  padding: "1.35rem",
                  borderRadius: "24px",
                  background: `${TEAM_ACCENTS[team]}18`,
                  border: `2px solid ${TEAM_ACCENTS[team]}`,
                }}
              >
                <div style={{ color: TEAM_ACCENTS[team], fontWeight: 700 }}>{TEAM_LABELS[team]}</div>
                <div style={{ marginTop: "0.35rem", fontSize: "1.4rem", fontWeight: 700 }}>
                  {teamState.name}
                </div>
                <div style={{ marginTop: "0.85rem", fontSize: "4rem", fontWeight: 800, lineHeight: 1 }}>
                  {getDisplayScore(teamState.rawScore)}
                </div>
                <div style={{ marginTop: "0.65rem", color: "#cbd5e1", lineHeight: 1.8 }}>
                  <div>実得点 {formatScore(teamState.rawScore)}</div>
                  <div>反則 {teamState.fouls}</div>
                  <div>失格 {teamState.disqualified ? "あり" : "なし"}</div>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
