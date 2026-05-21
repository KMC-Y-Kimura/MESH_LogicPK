import {
  SETUP_FOCUS_LABELS,
  TEAM_ACCENTS,
  TEAM_LABELS,
  formatScore,
} from "../lib/match";
import type { MatchState, Team } from "../types";

interface SetupOverviewProps {
  state: MatchState;
  title: string;
  subtitle: string;
  message: string;
  accent?: string;
  emphasizeTeam?: Team;
}

export function SetupOverview({
  state,
  title,
  subtitle,
  message,
  accent = "#93c5fd",
  emphasizeTeam,
}: SetupOverviewProps) {
  return (
    <>
      <section
        style={{
          padding: "1.5rem 2rem",
          borderRadius: "24px",
          background: "rgba(15, 23, 42, 0.95)",
          border: `1px solid ${accent}`,
          display: "grid",
          gap: "1rem",
        }}
      >
        <div>
          <div style={{ fontSize: "0.95rem", color: accent, fontWeight: 700 }}>{title}</div>
          <h1 style={{ fontSize: "2.4rem", marginTop: "0.25rem" }}>試合準備中</h1>
          <div style={{ marginTop: "0.65rem", color: "#cbd5e1", fontSize: "1.05rem" }}>{subtitle}</div>
          <div style={{ marginTop: "0.85rem", color: "#e2e8f0", lineHeight: 1.8 }}>{message}</div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "0.75rem",
          }}
        >
          <MetricCard label="制限時間" value={`${state.turnDurationSec} 秒`} />
          <MetricCard
            label="先攻"
            value={state.teams[state.firstThrowingTeam].name}
          />
          <MetricCard
            label="成功判定閾値"
            value={`${formatScore(state.sensor.calibration.triggerThreshold)}%`}
          />
          <MetricCard
            label="現在フォーカス"
            value={SETUP_FOCUS_LABELS[state.buttonControls.setup.focus]}
          />
          <MetricCard
            label="センサー最新値"
            value={
              state.sensor.latestNormalized === null
                ? "未取得"
                : `${formatScore(state.sensor.latestNormalized)}%`
            }
          />
          <MetricCard
            label="空ゴール基準"
            value={formatScore(state.sensor.calibration.emptyRaw)}
          />
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1rem",
        }}
      >
        {(["red", "blue"] as const).map((team) => {
          const teamState = state.teams[team];
          const highlight = emphasizeTeam === team;
          return (
            <div
              key={team}
              style={{
                padding: "1.5rem",
                borderRadius: "20px",
                background: `${TEAM_ACCENTS[team]}14`,
                border: `2px solid ${highlight ? TEAM_ACCENTS[team] : "#334155"}`,
              }}
            >
              <div style={{ color: TEAM_ACCENTS[team], fontWeight: 700 }}>{TEAM_LABELS[team]}</div>
              <div style={{ fontSize: "1.9rem", fontWeight: 700, marginTop: "0.35rem" }}>
                {teamState.name}
              </div>
              <div style={{ marginTop: "0.9rem", color: "#cbd5e1", lineHeight: 1.8 }}>
                <div>
                  基礎点合計: {teamState.totalBasePoints} / 必要{" "}
                  {Math.ceil(teamState.players.length * 2.5)}
                </div>
                <div>平均基礎点: {formatScore(teamState.averageBasePoints)}</div>
              </div>
              <div style={{ marginTop: "1rem", display: "grid", gap: "0.55rem" }}>
                {teamState.players.map((player) => (
                  <div
                    key={player.id}
                    style={{
                      padding: "0.75rem 0.9rem",
                      borderRadius: "12px",
                      background: "#0f172a",
                      border: "1px solid #334155",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "0.75rem",
                    }}
                  >
                    <span>{player.name}</span>
                    <span>{player.basePoints} 点</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section
        style={{
          padding: "1.25rem 1.5rem",
          borderRadius: "18px",
          background: "rgba(15, 23, 42, 0.94)",
          border: "1px solid #334155",
          display: "grid",
          gap: "1rem",
        }}
      >
        <div>
          <h2 style={{ fontSize: "1.2rem", marginBottom: "0.7rem" }}>ボール設定</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "0.75rem",
            }}
          >
            {state.balls.map((ball) => (
              <MetricCard
                key={ball.id}
                label={ball.name}
                value={`RED ${ball.initialCount.red}/${ball.remaining.red} | BLUE ${ball.initialCount.blue}/${ball.remaining.blue}`}
              />
            ))}
          </div>
        </div>
        <div>
          <h2 style={{ fontSize: "1.2rem", marginBottom: "0.7rem" }}>ボタン案内</h2>
          <div style={{ color: "#cbd5e1", lineHeight: 1.8 }}>
            <div>各チーム: ボタン1=次へ / ボタン2=確定またはやり直し</div>
            <div>ボール利用権は RED / BLUE で別管理です。共有ではありません。</div>
            <div>各チームのボタンは、単押し・ダブルクリック・長押しの違いを区別しません。</div>
            <div>審判: 単押し=次項目 / ダブルクリック=前項目または値変更 / 長押し=実行</div>
          </div>
        </div>
        {state.buttonControls.lastInput && (
          <div style={{ color: "#cbd5e1", lineHeight: 1.7 }}>
            最後のボタン入力: {state.buttonControls.lastInput.buttonId} / {state.buttonControls.lastInput.action}
            {" / "}
            {state.buttonControls.lastInput.summary}
          </div>
        )}
      </section>
    </>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "1rem 1.1rem",
        borderRadius: "16px",
        background: "#0f172a",
        border: "1px solid #334155",
      }}
    >
      <div style={{ fontSize: "0.82rem", color: "#94a3b8" }}>{label}</div>
      <div style={{ marginTop: "0.35rem", fontSize: "1.08rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}
