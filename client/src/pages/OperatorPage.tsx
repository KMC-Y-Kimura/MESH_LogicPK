import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { apiClient, useApiStore } from "../api/client";
import {
  TEAM_ACCENTS,
  TEAM_LABELS,
  formatScore,
  getDisplayScore,
} from "../lib/match";
import { Calibration, SetupMatchRequest, Team } from "../types";

const MIN_PLAYER_BASE_POINTS = 1;
const TEAM_ORDER: Team[] = ["red", "blue"];

interface SetupPlayerRow {
  redName: string;
  redBasePoints: number;
  blueName: string;
  blueBasePoints: number;
}

interface SetupFormState {
  redTeamName: string;
  blueTeamName: string;
  firstThrowingTeam: Team;
  playerRows: SetupPlayerRow[];
}

export default function OperatorPage() {
  const state = useApiStore((store) => store.state);
  const [setupForm, setSetupForm] = useState<SetupFormState | null>(null);
  const [calibrationForm, setCalibrationForm] = useState<Calibration | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!state) {
      return;
    }

    setSetupForm((current) => current ?? buildSetupFormFromState(state));
    setCalibrationForm((current) => current ?? { ...state.sensor.calibration });
  }, [state]);

  useEffect(() => {
    if (!state) {
      return;
    }

    setCalibrationForm({ ...state.sensor.calibration });
  }, [
    state?.sensor.calibration.minRaw,
    state?.sensor.calibration.emptyRaw,
    state?.sensor.calibration.triggerThreshold,
  ]);

  if (!state || !setupForm || !calibrationForm) {
    return <CenteredMessage message="初期状態を読み込み中..." />;
  }

  const publicScoreUrl =
    typeof window === "undefined" ? "/score" : new URL("/score", window.location.origin).toString();
  const expectedTotal = getExpectedBasePointsTotal(setupForm.playerRows.length);
  const redSetupTotal = sumTeamBasePoints(setupForm, "red");
  const blueSetupTotal = sumTeamBasePoints(setupForm, "blue");

  async function runAction(action: () => Promise<unknown>, successMessage?: string) {
    try {
      setError("");
      setNotice("");
      await action();
      if (successMessage) {
        setNotice(successMessage);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    }
  }

  function updatePlayerRows(updater: (rows: SetupPlayerRow[]) => SetupPlayerRow[]) {
    setSetupForm((current) =>
      current
        ? normalizeSetupForm({
            ...current,
            playerRows: updater(current.playerRows),
          })
        : current
    );
  }

  async function handleSaveSetup() {
    if (!setupForm) {
      return;
    }
    const currentSetupForm = normalizeSetupForm(setupForm);
    setSetupForm(currentSetupForm);

    const payload: SetupMatchRequest = {
      teams: {
        red: {
          name: currentSetupForm.redTeamName.trim(),
          players: currentSetupForm.playerRows.map((row) => ({
            name: row.redName.trim(),
            basePoints: Number(row.redBasePoints),
          })),
        },
        blue: {
          name: currentSetupForm.blueTeamName.trim(),
          players: currentSetupForm.playerRows.map((row) => ({
            name: row.blueName.trim(),
            basePoints: Number(row.blueBasePoints),
          })),
        },
      },
      firstThrowingTeam: currentSetupForm.firstThrowingTeam,
    };

    await runAction(() => apiClient.saveSetup(payload), "試合設定を保存しました");
  }

  async function handleStartMatch() {
    if (!setupForm) {
      return;
    }
    await runAction(() => apiClient.startMatch(setupForm.firstThrowingTeam), "投球順決定を開始しました");
  }

  async function handleSaveCalibration() {
    if (!calibrationForm) {
      return;
    }
    await runAction(
      () =>
        apiClient.updateCalibration({
          minRaw: Number(calibrationForm.minRaw),
          emptyRaw: Number(calibrationForm.emptyRaw),
          triggerThreshold: Number(calibrationForm.triggerThreshold),
        }),
      "キャリブレーションを保存しました"
    );
  }

  return (
    <div style={{ minHeight: "100vh", padding: "1.5rem", background: "#020617" }}>
      <div style={{ maxWidth: "1320px", margin: "0 auto", display: "grid", gap: "1rem" }}>
        <section style={heroStyle}>
          <div>
            <div style={{ color: "#93c5fd", fontWeight: 700 }}>RED Setup Screen</div>
            <h1 style={{ fontSize: "2.4rem", marginTop: "0.25rem" }}>試合準備</h1>
            <div style={{ marginTop: "0.75rem", color: "#cbd5e1", lineHeight: 1.8 }}>
              <div>この画面で設定とキャリブレーションを行い、開始すると RED 画面へ切り替わります。</div>
              <div>固定時間: 投球順決定 5 分 / ターン選択 10 秒 / 投球 20 秒</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem" }}>
            <MetricCard label="最新 Raw" value={state.sensor.latestRaw === null ? "未取得" : String(state.sensor.latestRaw)} />
            <MetricCard
              label="最新 正規化"
              value={
                state.sensor.latestNormalized === null
                  ? "未取得"
                  : `${formatScore(state.sensor.latestNormalized)}%`
              }
            />
            <MetricCard label="閾値" value={`${formatScore(state.sensor.calibration.triggerThreshold)}%`} />
          </div>
        </section>

        {error && (
          <section style={errorStyle}>
            <div style={{ fontWeight: 700 }}>エラー</div>
            <div style={{ marginTop: "0.35rem", whiteSpace: "pre-wrap" }}>{error}</div>
          </section>
        )}

        {notice && <section style={noticeStyle}>{notice}</section>}

        <section style={scoreGridStyle}>
          {TEAM_ORDER.map((team) => {
            const teamState = state.teams[team];
            return (
              <article
                key={team}
                style={{
                  ...panelStyle,
                  border: `1px solid ${TEAM_ACCENTS[team]}`,
                  background: `${TEAM_ACCENTS[team]}16`,
                }}
              >
                <div style={{ color: TEAM_ACCENTS[team], fontWeight: 700 }}>{TEAM_LABELS[team]}</div>
                <div style={{ marginTop: "0.3rem", fontSize: "1.6rem", fontWeight: 700 }}>{teamState.name}</div>
                <div style={{ marginTop: "0.75rem", fontSize: "2.6rem", fontWeight: 800 }}>
                  {getDisplayScore(teamState.rawScore)}
                </div>
                <div style={{ color: "#cbd5e1", lineHeight: 1.8 }}>
                  <div>実得点 {formatScore(teamState.rawScore)}</div>
                  <div>反則 {teamState.fouls}</div>
                  <div>平均基礎点 {formatScore(teamState.averageBasePoints)}</div>
                </div>
              </article>
            );
          })}
        </section>

        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>試合設定</h2>
              <div style={sectionHelpStyle}>
                人数は両チーム同数で、各チームの基礎点合計は `ceil(人数 × 2.5)` に一致する必要があります。
              </div>
            </div>
            <div style={buttonRowStyle}>
              <button onClick={() => setSetupForm(buildSetupFormFromState(state))} style={secondaryButtonStyle}>
                現在状態から再読込
              </button>
              <button onClick={handleSaveSetup} style={primaryButtonStyle("#2563eb")}>
                設定を保存
              </button>
              <button onClick={handleStartMatch} style={primaryButtonStyle("#16a34a")}>
                投球順決定を開始
              </button>
            </div>
          </div>

          <div style={formGridStyle}>
            <Field label="RED チーム名">
              <input
                value={setupForm.redTeamName}
                onChange={(event) =>
                  setSetupForm((current) => (current ? { ...current, redTeamName: event.target.value } : current))
                }
              />
            </Field>
            <Field label="BLUE チーム名">
              <input
                value={setupForm.blueTeamName}
                onChange={(event) =>
                  setSetupForm((current) => (current ? { ...current, blueTeamName: event.target.value } : current))
                }
              />
            </Field>
            <Field label="先攻チーム">
              <select
                value={setupForm.firstThrowingTeam}
                onChange={(event) =>
                  setSetupForm((current) =>
                    current ? { ...current, firstThrowingTeam: event.target.value as Team } : current
                  )
                }
              >
                <option value="red">RED</option>
                <option value="blue">BLUE</option>
              </select>
            </Field>
          </div>

          <div style={{ marginTop: "1rem", color: "#cbd5e1", lineHeight: 1.8 }}>
            <div>必要合計: 各チーム {expectedTotal} 点</div>
            <div>最後の 1 人は残り点数から自動計算されます。</div>
          </div>

          <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.9rem" }}>
            {setupForm.playerRows.map((row, index) => {
              const isLastPlayerRow = index === setupForm.playerRows.length - 1;
              const redMax = getEditableBasePointMax(setupForm.playerRows, "red", index);
              const blueMax = getEditableBasePointMax(setupForm.playerRows, "blue", index);

              return (
                <div key={index} style={playerRowStyle}>
                  <div style={{ color: "#94a3b8", fontWeight: 700 }}>P{index + 1}</div>
                  <input
                    value={row.redName}
                    placeholder="RED 名前"
                    onChange={(event) =>
                      updatePlayerRows((rows) =>
                        rows.map((entry, rowIndex) =>
                          rowIndex === index ? { ...entry, redName: event.target.value } : entry
                        )
                      )
                    }
                  />
                  <input
                    type="number"
                    min={MIN_PLAYER_BASE_POINTS}
                    max={redMax}
                    step={1}
                    value={row.redBasePoints}
                    readOnly={isLastPlayerRow}
                    style={isLastPlayerRow ? readOnlyInputStyle : undefined}
                    onChange={(event) =>
                      updatePlayerRows((rows) =>
                        rows.map((entry, rowIndex) =>
                          rowIndex === index ? { ...entry, redBasePoints: Number(event.target.value) } : entry
                        )
                      )
                    }
                  />
                  <input
                    value={row.blueName}
                    placeholder="BLUE 名前"
                    onChange={(event) =>
                      updatePlayerRows((rows) =>
                        rows.map((entry, rowIndex) =>
                          rowIndex === index ? { ...entry, blueName: event.target.value } : entry
                        )
                      )
                    }
                  />
                  <input
                    type="number"
                    min={MIN_PLAYER_BASE_POINTS}
                    max={blueMax}
                    step={1}
                    value={row.blueBasePoints}
                    readOnly={isLastPlayerRow}
                    style={isLastPlayerRow ? readOnlyInputStyle : undefined}
                    onChange={(event) =>
                      updatePlayerRows((rows) =>
                        rows.map((entry, rowIndex) =>
                          rowIndex === index ? { ...entry, blueBasePoints: Number(event.target.value) } : entry
                        )
                      )
                    }
                  />
                  <button
                    onClick={() => updatePlayerRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}
                    disabled={setupForm.playerRows.length <= 1}
                    style={smallSecondaryButtonStyle}
                  >
                    行削除
                  </button>
                </div>
              );
            })}
          </div>

          <div style={{ ...buttonRowStyle, marginTop: "0.9rem" }}>
            <button
              onClick={() =>
                updatePlayerRows((rows) => [
                  ...rows,
                  {
                    redName: `R${rows.length + 1}`,
                    redBasePoints: MIN_PLAYER_BASE_POINTS,
                    blueName: `B${rows.length + 1}`,
                    blueBasePoints: MIN_PLAYER_BASE_POINTS,
                  },
                ])
              }
              style={secondaryButtonStyle}
            >
              選手行を追加
            </button>
            <div style={{ alignSelf: "center", color: "#cbd5e1" }}>
              RED 合計 {redSetupTotal} / BLUE 合計 {blueSetupTotal}
            </div>
          </div>
        </section>

        <section style={twoColumnStyle}>
          <div style={panelStyle}>
            <h2 style={sectionTitleStyle}>センサー設定</h2>
            <div style={{ display: "grid", gap: "0.8rem", marginTop: "0.9rem" }}>
              <Field label="遮光時 Raw (minRaw)">
                <input
                  type="number"
                  value={calibrationForm.minRaw}
                  onChange={(event) =>
                    setCalibrationForm((current) =>
                      current ? { ...current, minRaw: Number(event.target.value) } : current
                    )
                  }
                />
              </Field>
              <Field label="空ゴール Raw (emptyRaw)">
                <input
                  type="number"
                  value={calibrationForm.emptyRaw}
                  onChange={(event) =>
                    setCalibrationForm((current) =>
                      current ? { ...current, emptyRaw: Number(event.target.value) } : current
                    )
                  }
                />
              </Field>
              <Field label="成功判定閾値 (%)">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={calibrationForm.triggerThreshold}
                  onChange={(event) =>
                    setCalibrationForm((current) =>
                      current ? { ...current, triggerThreshold: Number(event.target.value) } : current
                    )
                  }
                />
              </Field>
            </div>
            <div style={{ ...buttonRowStyle, marginTop: "0.9rem" }}>
              <button
                onClick={() => runAction(() => apiClient.autoCalibrate(), "自動キャリブレーションを実行しました")}
                style={secondaryButtonStyle}
              >
                自動キャリブレーション
              </button>
              <button
                onClick={() =>
                  runAction(() => apiClient.captureCalibrationBlocked(), "遮光時の値を 0 として保存しました")
                }
                style={secondaryButtonStyle}
              >
                最低値を 0 に固定
              </button>
              <button
                onClick={() =>
                  runAction(() => apiClient.captureCalibrationEmpty(), "現在値を空ゴールとして保存しました")
                }
                style={secondaryButtonStyle}
              >
                現在値を空ゴールとして保存
              </button>
              <button onClick={handleSaveCalibration} style={primaryButtonStyle("#2563eb")}>
                手動値を保存
              </button>
            </div>
          </div>

          <div style={panelStyle}>
            <h2 style={sectionTitleStyle}>公開用スコア画面</h2>
            <div style={{ marginTop: "0.8rem", color: "#cbd5e1", lineHeight: 1.8 }}>
              <div>同じ Wi-Fi のスマートフォンから、Vite の Network URL に `/score` を付けて開きます。</div>
              <div style={{ marginTop: "0.5rem", wordBreak: "break-all" }}>{publicScoreUrl}</div>
            </div>
            <div style={{ ...buttonRowStyle, marginTop: "1rem" }}>
              <a href="/team/red" style={linkStyle}>
                RED 画面
              </a>
              <a href="/team/blue" style={linkStyle}>
                BLUE 画面
              </a>
              <a href="/score" style={linkStyle}>
                スマホ用スコア
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function buildSetupFormFromState(state: NonNullable<ReturnType<typeof useApiStore.getState>["state"]>): SetupFormState {
  const playerCount = Math.max(state.teams.red.players.length, state.teams.blue.players.length);
  const playerRows: SetupPlayerRow[] = Array.from({ length: playerCount }, (_, index) => ({
    redName: state.teams.red.players[index]?.name ?? `R${index + 1}`,
    redBasePoints: state.teams.red.players[index]?.basePoints ?? MIN_PLAYER_BASE_POINTS,
    blueName: state.teams.blue.players[index]?.name ?? `B${index + 1}`,
    blueBasePoints: state.teams.blue.players[index]?.basePoints ?? MIN_PLAYER_BASE_POINTS,
  }));

  return normalizeSetupForm({
    redTeamName: state.teams.red.name,
    blueTeamName: state.teams.blue.name,
    firstThrowingTeam: state.firstThrowingTeam,
    playerRows,
  });
}

function getExpectedBasePointsTotal(playerCount: number): number {
  return Math.ceil(playerCount * 2.5);
}

function sumTeamBasePoints(form: SetupFormState, team: Team): number {
  return form.playerRows.reduce((sum, row) => {
    return sum + Number(team === "red" ? row.redBasePoints : row.blueBasePoints);
  }, 0);
}

function normalizeSetupForm(form: SetupFormState): SetupFormState {
  return {
    ...form,
    playerRows: normalizeSetupPlayerRows(form.playerRows),
  };
}

function normalizeSetupPlayerRows(rows: SetupPlayerRow[]): SetupPlayerRow[] {
  if (rows.length === 0) {
    return rows;
  }

  const redSourceValues = rows.map((row) => row.redBasePoints);
  const blueSourceValues = rows.map((row) => row.blueBasePoints);
  const redBasePoints = hasConfiguredBasePoints(redSourceValues)
    ? normalizeTeamBasePoints(redSourceValues)
    : createDefaultBasePointValues(rows.length);
  const blueBasePoints = hasConfiguredBasePoints(blueSourceValues)
    ? normalizeTeamBasePoints(blueSourceValues)
    : createDefaultBasePointValues(rows.length);

  return rows.map((row, index) => ({
    ...row,
    redBasePoints: redBasePoints[index],
    blueBasePoints: blueBasePoints[index],
  }));
}

function createDefaultBasePointValues(playerCount: number): number[] {
  if (playerCount <= 0) {
    return [];
  }

  const total = getExpectedBasePointsTotal(playerCount);
  const baseValue = Math.floor(total / playerCount);
  const remainder = total % playerCount;

  return Array.from({ length: playerCount }, (_, index) => baseValue + (index < remainder ? 1 : 0));
}

function hasConfiguredBasePoints(values: number[]): boolean {
  return values.some((value) => Number.isFinite(value) && value >= MIN_PLAYER_BASE_POINTS);
}

function normalizeTeamBasePoints(values: number[]): number[] {
  if (values.length === 0) {
    return [];
  }

  const normalized: number[] = [];
  let remainingTotal = getExpectedBasePointsTotal(values.length);

  values.forEach((value, index) => {
    const remainingSlots = values.length - index - 1;

    if (remainingSlots === 0) {
      normalized.push(remainingTotal);
      return;
    }

    const maxValue = remainingTotal - remainingSlots;
    const sanitizedValue = sanitizeBasePointValue(value);
    const clampedValue = Math.max(MIN_PLAYER_BASE_POINTS, Math.min(maxValue, sanitizedValue));
    normalized.push(clampedValue);
    remainingTotal -= clampedValue;
  });

  return normalized;
}

function sanitizeBasePointValue(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_PLAYER_BASE_POINTS;
  }

  return Math.max(MIN_PLAYER_BASE_POINTS, Math.floor(value));
}

function getEditableBasePointMax(rows: SetupPlayerRow[], team: Team, index: number): number {
  const expectedTotal = getExpectedBasePointsTotal(rows.length);
  const previousTotal = rows.slice(0, index).reduce((sum, row) => {
    return sum + (team === "red" ? row.redBasePoints : row.blueBasePoints);
  }, 0);
  const remainingSlots = rows.length - index - 1;

  return Math.max(MIN_PLAYER_BASE_POINTS, expectedTotal - previousTotal - remainingSlots);
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
        fontSize: "1.4rem",
      }}
    >
      {message}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "grid", gap: "0.4rem" }}>
      <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>{label}</span>
      {children}
    </label>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={metricCardStyle}>
      <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>{label}</div>
      <div style={{ marginTop: "0.3rem", fontSize: "1.05rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const heroStyle: CSSProperties = {
  padding: "1.5rem 1.75rem",
  borderRadius: "24px",
  background: "rgba(15, 23, 42, 0.94)",
  border: "1px solid #334155",
  display: "grid",
  gridTemplateColumns: "1.1fr 0.9fr",
  gap: "1rem",
  alignItems: "center",
};

const panelStyle: CSSProperties = {
  padding: "1.3rem 1.4rem",
  borderRadius: "22px",
  background: "rgba(15, 23, 42, 0.94)",
  border: "1px solid #334155",
};

const scoreGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: "1rem",
};

const twoColumnStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "1rem",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "1rem",
  flexWrap: "wrap",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: "1.3rem",
  margin: 0,
};

const sectionHelpStyle: CSSProperties = {
  color: "#94a3b8",
  marginTop: "0.35rem",
  lineHeight: 1.7,
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "0.9rem",
  marginTop: "1rem",
};

const playerRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "48px 1.1fr 120px 1.1fr 120px 90px",
  gap: "0.75rem",
  alignItems: "center",
};

const metricCardStyle: CSSProperties = {
  padding: "0.95rem 1rem",
  borderRadius: "16px",
  background: "#0f172a",
  border: "1px solid #334155",
};

const readOnlyInputStyle: CSSProperties = {
  background: "#1e293b",
  color: "#e2e8f0",
  cursor: "not-allowed",
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  flexWrap: "wrap",
};

const errorStyle: CSSProperties = {
  padding: "1rem 1.25rem",
  borderRadius: "16px",
  border: "1px solid #ef4444",
  background: "rgba(127, 29, 29, 0.35)",
};

const noticeStyle: CSSProperties = {
  padding: "0.9rem 1.2rem",
  borderRadius: "16px",
  border: "1px solid #16a34a",
  background: "rgba(20, 83, 45, 0.35)",
  color: "#dcfce7",
};

function primaryButtonStyle(color: string, disabled = false): CSSProperties {
  return {
    background: color,
    color: "white",
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

const secondaryButtonStyle: CSSProperties = {
  background: "#334155",
  color: "white",
};

const smallSecondaryButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  padding: "0.72rem 0.85rem",
};

const linkStyle: CSSProperties = {
  color: "#93c5fd",
  textDecoration: "none",
  fontWeight: 700,
};
