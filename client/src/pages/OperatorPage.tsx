import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { apiClient, useApiStore } from "../api/client";
import { EventLog } from "../components/EventLog";
import {
  BONUS_LABELS,
  DISTANCE_LABELS,
  PHASE_LABELS,
  SETUP_FOCUS_LABELS,
  TEAM_ACCENTS,
  TEAM_LABELS,
  findBallName,
  findPlayerName,
  formatScore,
  getDisplayScore,
  getRemainingBonusRights,
  getWinnerSummary,
} from "../lib/match";
import { Calibration, DistanceId, Team, TurnOutcome } from "../types";

const DISTANCE_ORDER: DistanceId[] = ["near", "middle", "far"];
const TEAM_ORDER: Team[] = ["red", "blue"];

interface SetupPlayerRow {
  redName: string;
  redBasePoints: number;
  blueName: string;
  blueBasePoints: number;
}

interface SetupBallRow {
  name: string;
  initialCount: Record<Team, number>;
}

interface SetupFormState {
  redTeamName: string;
  blueTeamName: string;
  turnDurationSec: number;
  firstThrowingTeam: Team;
  playerRows: SetupPlayerRow[];
  balls: SetupBallRow[];
}

interface ResolutionFormState {
  outcome: TurnOutcome;
  actualDistanceId: DistanceId | "";
  foulTeam: Team | "";
  disqualifiedTeam: Team | "";
  notes: string;
}

export default function OperatorPage() {
  const state = useApiStore((store) => store.state);
  const eventLog = useApiStore((store) => store.eventLog);
  const [setupForm, setSetupForm] = useState<SetupFormState | null>(null);
  const [calibrationForm, setCalibrationForm] = useState<Calibration | null>(null);
  const [resolutionForm, setResolutionForm] = useState<ResolutionFormState>({
    outcome: "miss",
    actualDistanceId: "",
    foulTeam: "",
    disqualifiedTeam: "",
    notes: "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [, setNow] = useState(Date.now());

  useEffect(() => {
    if (state && !setupForm) {
      setSetupForm(buildSetupFormFromState(state));
    }
  }, [state, setupForm]);

  useEffect(() => {
    if (!state) {
      return;
    }

    setSetupForm((current) =>
      current
        ? {
            ...current,
            turnDurationSec: state.turnDurationSec,
            firstThrowingTeam: state.firstThrowingTeam,
          }
        : buildSetupFormFromState(state)
    );
  }, [state?.turnDurationSec, state?.firstThrowingTeam]);

  useEffect(() => {
    if (state && !calibrationForm) {
      setCalibrationForm({ ...state.sensor.calibration });
    }
  }, [state, calibrationForm]);

  useEffect(() => {
    if (!state) {
      return;
    }

    setCalibrationForm({
      ...state.sensor.calibration,
    });
  }, [
    state?.sensor.calibration.minRaw,
    state?.sensor.calibration.emptyRaw,
    state?.sensor.calibration.triggerThreshold,
  ]);

  useEffect(() => {
    const currentTurn = state?.currentTurn;
    setResolutionForm({
      outcome: currentTurn?.sensorTriggeredAt ? "success" : "miss",
      actualDistanceId: currentTurn?.selection.distanceId ?? "",
      foulTeam: "",
      disqualifiedTeam: "",
      notes: currentTurn?.notes ?? "",
    });
  }, [state?.currentTurn?.turnNumber, state?.phase]);

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

  if (!state || !setupForm || !calibrationForm) {
    return <CenteredMessage message="初期状態を読み込み中..." />;
  }

  const currentTurn = state.currentTurn;
  const selectedShooter = currentTurn
    ? findPlayerName(state, currentTurn.throwingTeam, currentTurn.selection.shooterId)
    : "未設定";
  const selectedBall = currentTurn ? findBallName(state, currentTurn.selection.ballId) : "未設定";
  const selectedDistance =
    currentTurn?.selection.distanceId ? DISTANCE_LABELS[currentTurn.selection.distanceId] : "未設定";
  const selectedBonus =
    currentTurn?.selection.bonusChoice ? BONUS_LABELS[currentTurn.selection.bonusChoice] : "未設定";
  const throwingBonusRights = currentTurn ? getRemainingBonusRights(state, currentTurn.throwingTeam) : 0;
  const defendingBonusRights = currentTurn ? getRemainingBonusRights(state, currentTurn.defendingTeam) : 0;
  const remainingSeconds =
    state.phase === "active" && currentTurn?.startedAt
      ? Math.max(0, Math.ceil((state.turnDurationSec * 1000 - (Date.now() - currentTurn.startedAt)) / 1000))
      : null;
  const redExpected = Math.ceil(state.teams.red.players.length * 2.5);
  const blueExpected = Math.ceil(state.teams.blue.players.length * 2.5);
  const selectionComplete = Boolean(
    currentTurn?.selection.shooterId &&
      currentTurn?.selection.distanceId &&
      currentTurn?.selection.ballId &&
      currentTurn?.selection.bonusChoice
  );

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

  async function handleSaveSetup() {
    if (!setupForm) {
      return;
    }

    await runAction(async () => {
      const currentSetupForm = setupForm;
      const payload = {
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
        balls: currentSetupForm.balls.map((ball) => ({
          name: ball.name.trim(),
          initialCount: {
            red: Number(ball.initialCount.red),
            blue: Number(ball.initialCount.blue),
          },
        })),
        turnDurationSec: Number(currentSetupForm.turnDurationSec),
        firstThrowingTeam: currentSetupForm.firstThrowingTeam,
      };

      await apiClient.saveSetup(payload);
    }, "試合設定を保存しました");
  }

  async function handleSaveCalibration() {
    if (!calibrationForm) {
      return;
    }

    await runAction(
      () => {
        const currentCalibrationForm = calibrationForm;
        return apiClient.updateCalibration({
          minRaw: Number(currentCalibrationForm.minRaw),
          emptyRaw: Number(currentCalibrationForm.emptyRaw),
          triggerThreshold: Number(currentCalibrationForm.triggerThreshold),
        });
      },
      "キャリブレーションを保存しました"
    );
  }

  async function handleResolveTurn() {
    await runAction(
      () =>
        apiClient.resolveTurn({
          outcome: resolutionForm.outcome,
          actualDistanceId: resolutionForm.actualDistanceId || undefined,
          foulTeam: resolutionForm.foulTeam || undefined,
          disqualifiedTeam: resolutionForm.disqualifiedTeam || undefined,
          notes: resolutionForm.notes.trim() || undefined,
        }),
      "ターン結果を確定しました"
    );
  }

  return (
    <div style={{ minHeight: "100vh", padding: "1.5rem", background: "#020617" }}>
      <div style={{ maxWidth: "1520px", margin: "0 auto", display: "grid", gap: "1.25rem" }}>
        <section style={heroStyle}>
          <div>
            <div style={{ color: "#93c5fd", fontWeight: 700, fontSize: "0.95rem" }}>
              Logic PK RED Setup Screen
            </div>
            <h1 style={{ fontSize: "2.6rem", marginTop: "0.25rem" }}>{PHASE_LABELS[state.phase]}</h1>
            <div style={{ color: "#cbd5e1", marginTop: "0.6rem", fontSize: "1.05rem" }}>
              ラウンド {state.roundNumber}
              {currentTurn ? ` / ターン ${currentTurn.turnNumber}` : ""}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" }}>
            <MetricCard label="残り時間" value={remainingSeconds === null ? "−" : `${remainingSeconds}s`} />
            <MetricCard
              label="センサー"
              value={
                state.sensor.latestNormalized === null
                  ? "未取得"
                  : `${formatScore(state.sensor.latestNormalized)}%`
              }
            />
            <MetricCard label="成功検知" value={state.sensor.successDetected ? "あり" : "なし"} />
            <MetricCard
              label="延長戦"
              value={state.requiresOvertime ? "必要" : "不要"}
            />
          </div>
        </section>

        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>審判ボタン操作</h2>
              <div style={sectionHelpStyle}>
                setup 中の編集は RED 画面で行います。審判ボタンは単押し/ダブルクリックで項目移動、長押しで実行です。
              </div>
            </div>
          </div>
          <div style={selectionSummaryGridStyle}>
            <MetricCard
              label="現在のフォーカス"
              value={SETUP_FOCUS_LABELS[state.buttonControls.setup.focus]}
            />
            <MetricCard
              label="制限時間候補"
              value={`${state.turnDurationSec} 秒`}
            />
            <MetricCard
              label="成功判定閾値"
              value={`${formatScore(state.sensor.calibration.triggerThreshold)}%`}
            />
            <MetricCard
              label="最後のボタン入力"
              value={
                state.buttonControls.lastInput
                  ? `${state.buttonControls.lastInput.buttonId} / ${state.buttonControls.lastInput.action}`
                  : "まだありません"
              }
            />
          </div>
          {state.buttonControls.lastInput && (
            <div style={{ marginTop: "0.9rem", color: "#cbd5e1" }}>
              {state.buttonControls.lastInput.summary}
            </div>
          )}
        </section>

        {error && (
          <section style={errorStyle}>
            <div style={{ fontWeight: 700 }}>エラー</div>
            <div style={{ marginTop: "0.35rem", whiteSpace: "pre-wrap" }}>{error}</div>
          </section>
        )}

        {notice && (
          <section style={noticeStyle}>
            <div>{notice}</div>
          </section>
        )}

        <section style={gridTwoStyle}>
          {TEAM_ORDER.map((team) => {
            const teamState = state.teams[team];
            const expected = team === "red" ? redExpected : blueExpected;
            return (
              <div
                key={team}
                style={{
                  ...panelStyle,
                  border: `1px solid ${TEAM_ACCENTS[team]}`,
                  background: `${TEAM_ACCENTS[team]}16`,
                }}
              >
                <div style={{ color: TEAM_ACCENTS[team], fontWeight: 700 }}>{TEAM_LABELS[team]}</div>
                <div style={{ fontSize: "1.8rem", fontWeight: 700, marginTop: "0.3rem" }}>
                  {teamState.name}
                </div>
                <div style={{ marginTop: "1rem", fontSize: "3rem", fontWeight: 800 }}>
                  {getDisplayScore(teamState.rawScore)}
                </div>
                <div style={{ color: "#e2e8f0" }}>実得点 {formatScore(teamState.rawScore)}</div>
                <div style={{ marginTop: "1rem", color: "#cbd5e1", lineHeight: 1.8 }}>
                  <div>
                    基礎点合計: {teamState.totalBasePoints} / 必要 {expected}
                  </div>
                  <div>平均基礎点: {formatScore(teamState.averageBasePoints)}</div>
                  <div>反則数: {teamState.fouls}</div>
                  <div>失格: {teamState.disqualified ? "あり" : "なし"}</div>
                </div>
              </div>
            );
          })}
        </section>

        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>試合設定</h2>
              <div style={sectionHelpStyle}>
                人数は両チーム同数で、各チームの基礎点合計は `ceil(人数 × 2.5)` に一致している必要があります。
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button onClick={() => setSetupForm(buildSetupFormFromState(state))} style={secondaryButtonStyle}>
                現在状態から再読込
              </button>
              <button onClick={handleSaveSetup} style={primaryButtonStyle("#2563eb")}>
                設定を保存
              </button>
            </div>
          </div>

          <div style={formGridStyle}>
            <Field label="RED チーム名">
              <input
                value={setupForm.redTeamName}
                onChange={(event) =>
                  setSetupForm((current) =>
                    current ? { ...current, redTeamName: event.target.value } : current
                  )
                }
              />
            </Field>
            <Field label="BLUE チーム名">
              <input
                value={setupForm.blueTeamName}
                onChange={(event) =>
                  setSetupForm((current) =>
                    current ? { ...current, blueTeamName: event.target.value } : current
                  )
                }
              />
            </Field>
            <Field label="1ターン秒数">
              <input
                type="number"
                min={1}
                max={60}
                value={setupForm.turnDurationSec}
                onChange={(event) =>
                  setSetupForm((current) =>
                    current
                      ? { ...current, turnDurationSec: Number(event.target.value) }
                      : current
                  )
                }
              />
            </Field>
            <Field label="先攻チーム">
              <select
                value={setupForm.firstThrowingTeam}
                onChange={(event) =>
                  setSetupForm((current) =>
                    current
                      ? { ...current, firstThrowingTeam: event.target.value as Team }
                      : current
                  )
                }
              >
                <option value="red">RED</option>
                <option value="blue">BLUE</option>
              </select>
            </Field>
          </div>

          <div style={{ marginTop: "1.2rem" }}>
            <div style={subheadingStyle}>選手と基礎点</div>
            <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
              {setupForm.playerRows.map((row, index) => (
                <div key={index} style={playerRowStyle}>
                  <div style={{ color: "#94a3b8", fontWeight: 700, minWidth: "48px" }}>
                    P{index + 1}
                  </div>
                  <input
                    value={row.redName}
                    placeholder="RED 名前"
                    onChange={(event) =>
                      setSetupForm((current) =>
                        current
                          ? {
                              ...current,
                              playerRows: current.playerRows.map((entry, rowIndex) =>
                                rowIndex === index ? { ...entry, redName: event.target.value } : entry
                              ),
                            }
                          : current
                      )
                    }
                  />
                  <input
                    type="number"
                    value={row.redBasePoints}
                    placeholder="RED 点"
                    onChange={(event) =>
                      setSetupForm((current) =>
                        current
                          ? {
                              ...current,
                              playerRows: current.playerRows.map((entry, rowIndex) =>
                                rowIndex === index
                                  ? { ...entry, redBasePoints: Number(event.target.value) }
                                  : entry
                              ),
                            }
                          : current
                      )
                    }
                  />
                  <input
                    value={row.blueName}
                    placeholder="BLUE 名前"
                    onChange={(event) =>
                      setSetupForm((current) =>
                        current
                          ? {
                              ...current,
                              playerRows: current.playerRows.map((entry, rowIndex) =>
                                rowIndex === index ? { ...entry, blueName: event.target.value } : entry
                              ),
                            }
                          : current
                      )
                    }
                  />
                  <input
                    type="number"
                    value={row.blueBasePoints}
                    placeholder="BLUE 点"
                    onChange={(event) =>
                      setSetupForm((current) =>
                        current
                          ? {
                              ...current,
                              playerRows: current.playerRows.map((entry, rowIndex) =>
                                rowIndex === index
                                  ? { ...entry, blueBasePoints: Number(event.target.value) }
                                  : entry
                              ),
                            }
                          : current
                      )
                    }
                  />
                  <button
                    onClick={() =>
                      setSetupForm((current) =>
                        current && current.playerRows.length > 1
                          ? {
                              ...current,
                              playerRows: current.playerRows.filter((_, rowIndex) => rowIndex !== index),
                            }
                          : current
                      )
                    }
                    disabled={setupForm.playerRows.length <= 1}
                    style={smallSecondaryButtonStyle}
                  >
                    行削除
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.9rem", flexWrap: "wrap" }}>
              <button
                onClick={() =>
                  setSetupForm((current) =>
                    current
                      ? {
                          ...current,
                          playerRows: [
                            ...current.playerRows,
                            {
                              redName: `R${current.playerRows.length + 1}`,
                              redBasePoints: 0,
                              blueName: `B${current.playerRows.length + 1}`,
                              blueBasePoints: 0,
                            },
                          ],
                        }
                      : current
                  )
                }
                style={secondaryButtonStyle}
              >
                選手行を追加
              </button>
              <div style={{ color: "#cbd5e1", alignSelf: "center" }}>
                RED 合計 {sumRedBasePoints(setupForm)} / BLUE 合計 {sumBlueBasePoints(setupForm)}
              </div>
            </div>
          </div>

          <div style={{ marginTop: "1.2rem" }}>
            <div style={subheadingStyle}>共通ボールとチーム別利用権</div>
            <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
              {setupForm.balls.map((ball, index) => (
                <div key={index} style={ballRowStyle}>
                  <input
                    value={ball.name}
                    placeholder="ボール名"
                    onChange={(event) =>
                      setSetupForm((current) =>
                        current
                          ? {
                              ...current,
                              balls: current.balls.map((entry, ballIndex) =>
                                ballIndex === index ? { ...entry, name: event.target.value } : entry
                              ),
                            }
                          : current
                      )
                    }
                  />
                  <input
                    type="number"
                    min={1}
                    max={2}
                    value={ball.initialCount.red}
                    placeholder="RED"
                    onChange={(event) =>
                      setSetupForm((current) =>
                        current
                          ? {
                              ...current,
                              balls: current.balls.map((entry, ballIndex) =>
                                ballIndex === index
                                  ? {
                                      ...entry,
                                      initialCount: {
                                        ...entry.initialCount,
                                        red: Number(event.target.value),
                                      },
                                    }
                                  : entry
                              ),
                            }
                          : current
                      )
                    }
                  />
                  <input
                    type="number"
                    min={1}
                    max={2}
                    value={ball.initialCount.blue}
                    placeholder="BLUE"
                    onChange={(event) =>
                      setSetupForm((current) =>
                        current
                          ? {
                              ...current,
                              balls: current.balls.map((entry, ballIndex) =>
                                ballIndex === index
                                  ? {
                                      ...entry,
                                      initialCount: {
                                        ...entry.initialCount,
                                        blue: Number(event.target.value),
                                      },
                                    }
                                  : entry
                              ),
                            }
                          : current
                      )
                    }
                  />
                  <button
                    onClick={() =>
                      setSetupForm((current) =>
                        current && current.balls.length > 3
                          ? {
                              ...current,
                              balls: current.balls.filter((_, ballIndex) => ballIndex !== index),
                            }
                          : current
                      )
                    }
                    disabled={setupForm.balls.length <= 3}
                    style={smallSecondaryButtonStyle}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() =>
                setSetupForm((current) =>
                  current
                    ? {
                        ...current,
                        balls: [
                          ...current.balls,
                          {
                            name: `ボール${String.fromCharCode(65 + current.balls.length)}`,
                            initialCount: { red: 1, blue: 1 },
                          },
                        ],
                      }
                    : current
                )
              }
              style={{ ...secondaryButtonStyle, marginTop: "0.9rem" }}
            >
              ボールを追加
            </button>
          </div>
        </section>

        <section style={gridTwoStyle}>
          <div style={panelStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={sectionTitleStyle}>ターン選択状況</h2>
                <div style={sectionHelpStyle}>
                  チーム画面が使えない場合は、この画面から代替操作できます。
                </div>
              </div>
              <div style={{ color: "#cbd5e1", fontWeight: 700 }}>
                {currentTurn
                  ? `${state.teams[currentTurn.throwingTeam].name} が投げる側`
                  : "ターン未生成"}
              </div>
            </div>

            {!currentTurn ? (
              <div style={{ color: "#94a3b8" }}>試合開始後にターンが生成されます。</div>
            ) : (
              <>
                <div style={selectionSummaryGridStyle}>
                  <MetricCard label="投球者" value={selectedShooter} />
                  <MetricCard label="距離" value={selectedDistance} />
                  <MetricCard label="ボール" value={selectedBall} />
                  <MetricCard label="追加得点" value={selectedBonus} />
                </div>

                <div style={{ marginTop: "1rem", display: "grid", gap: "1rem" }}>
                  <SelectionBlock title={`投げる側: ${state.teams[currentTurn.throwingTeam].name}`}>
                    <div style={choiceGridStyle}>
                      {state.teams[currentTurn.throwingTeam].players.map((player) => {
                        const selected = currentTurn.selection.shooterId === player.id;
                        const disabled = state.phase !== "selection" || player.hasActedInRound;
                        return (
                          <button
                            key={player.id}
                            onClick={() => runAction(() => apiClient.selectShooter(player.id))}
                            disabled={disabled}
                            style={choiceButtonStyle(selected, TEAM_ACCENTS[currentTurn.throwingTeam], disabled)}
                          >
                            <div style={{ fontWeight: 700 }}>{player.name}</div>
                            <div style={{ fontSize: "0.88rem", color: "#cbd5e1" }}>
                              基礎点 {player.basePoints}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ ...choiceGridStyle, marginTop: "0.75rem" }}>
                      {DISTANCE_ORDER.map((distanceId) => {
                        const selected = currentTurn.selection.distanceId === distanceId;
                        return (
                          <button
                            key={distanceId}
                            onClick={() => runAction(() => apiClient.selectDistance(distanceId))}
                            disabled={state.phase !== "selection"}
                            style={choiceButtonStyle(selected, TEAM_ACCENTS[currentTurn.throwingTeam], state.phase !== "selection")}
                          >
                            {DISTANCE_LABELS[distanceId]}
                          </button>
                        );
                      })}
                    </div>
                  </SelectionBlock>

                  <SelectionBlock title={`守る側: ${state.teams[currentTurn.defendingTeam].name}`}>
                    <div style={choiceGridStyle}>
                      {state.balls.map((ball) => {
                        const selected = currentTurn.selection.ballId === ball.id;
                        const disabled =
                          state.phase !== "selection" ||
                          ball.remaining[currentTurn.defendingTeam] <= 0;
                        return (
                          <button
                            key={ball.id}
                            onClick={() => runAction(() => apiClient.selectBall(ball.id))}
                            disabled={disabled}
                            style={choiceButtonStyle(selected, TEAM_ACCENTS[currentTurn.defendingTeam], disabled)}
                          >
                            <div style={{ fontWeight: 700 }}>{ball.name}</div>
                            <div style={{ fontSize: "0.88rem", color: "#cbd5e1" }}>
                              RED 残り {ball.remaining.red} / BLUE 残り {ball.remaining.blue}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: "0.75rem", color: "#cbd5e1", lineHeight: 1.7 }}>
                      自チームへ平均基礎点: 残り {defendingBonusRights}
                      <br />
                      相手側へ距離点: 残り {throwingBonusRights}
                    </div>
                    <div style={{ ...choiceGridStyle, marginTop: "0.75rem" }}>
                      {(["opponentAverage", "distance"] as const).map((bonusChoice) => {
                        const selected = currentTurn.selection.bonusChoice === bonusChoice;
                        const remaining =
                          bonusChoice === "opponentAverage" ? defendingBonusRights : throwingBonusRights;
                        const disabled = state.phase !== "selection" || remaining <= 0;
                        return (
                          <button
                            key={bonusChoice}
                            onClick={() => runAction(() => apiClient.selectBonus(bonusChoice))}
                            disabled={disabled}
                            style={choiceButtonStyle(selected, TEAM_ACCENTS[currentTurn.defendingTeam], disabled)}
                          >
                            <div>{BONUS_LABELS[bonusChoice]}</div>
                            <div style={{ fontSize: "0.85rem", color: "#cbd5e1" }}>残り {remaining}</div>
                          </button>
                        );
                      })}
                    </div>
                  </SelectionBlock>
                </div>
              </>
            )}
          </div>

          <div style={panelStyle}>
            <h2 style={sectionTitleStyle}>試合進行と判定</h2>
            <div style={buttonRowStyle}>
              <button
                onClick={() => runAction(() => apiClient.startMatch(setupForm.firstThrowingTeam), "試合を開始しました")}
                disabled={state.phase !== "setup"}
                style={primaryButtonStyle("#16a34a", state.phase !== "setup")}
              >
                試合開始
              </button>
              <button
                onClick={() =>
                  runAction(() => apiClient.startOvertime(state.firstThrowingTeam), "延長戦を開始しました")
                }
                disabled={!state.requiresOvertime}
                style={primaryButtonStyle("#ca8a04", !state.requiresOvertime)}
              >
                延長戦開始
              </button>
              <button
                onClick={() => runAction(() => apiClient.resetMatch(), "試合状態をリセットしました")}
                style={primaryButtonStyle("#475569")}
              >
                リセット
              </button>
            </div>

            <div style={{ marginTop: "1.25rem", padding: "1rem", borderRadius: "16px", background: "#0f172a", border: "1px solid #334155" }}>
              <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>ターン開始条件</div>
              <div style={{ marginTop: "0.45rem", color: selectionComplete ? "#86efac" : "#fca5a5" }}>
                {selectionComplete ? "投球者・距離・ボール・追加得点の向きがすべて選択済みです" : "選択が未完了です"}
              </div>
              <button
                onClick={() => runAction(() => apiClient.startTurn(), "投球ターンを開始しました")}
                disabled={state.phase !== "selection" || !selectionComplete}
                style={{ ...primaryButtonStyle("#2563eb", state.phase !== "selection" || !selectionComplete), marginTop: "0.9rem" }}
              >
                ターン開始
              </button>
            </div>

            <div style={{ marginTop: "1.25rem", padding: "1rem", borderRadius: "16px", background: "#0f172a", border: "1px solid #334155" }}>
              <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>アクティブターン制御</div>
              <div style={{ marginTop: "0.45rem", color: "#cbd5e1" }}>
                センサーが入らない場合や手動判定へ切り替える場合に使います。
              </div>
              <button
                onClick={() => runAction(() => apiClient.reviewTurn(), "レビューへ移行しました")}
                disabled={state.phase !== "active"}
                style={{ ...primaryButtonStyle("#d97706", state.phase !== "active"), marginTop: "0.9rem" }}
              >
                手動でレビューへ移行
              </button>
            </div>

            <div style={{ marginTop: "1.25rem" }}>
              <div style={subheadingStyle}>ターン結果の確定</div>
              <div style={{ display: "grid", gap: "0.8rem", marginTop: "0.75rem" }}>
                <Field label="結果">
                  <select
                    value={resolutionForm.outcome}
                    onChange={(event) =>
                      setResolutionForm((current) => ({
                        ...current,
                        outcome: event.target.value as TurnOutcome,
                      }))
                    }
                  >
                    <option value="success">成功</option>
                    <option value="miss">失敗</option>
                    <option value="invalid">無効</option>
                  </select>
                </Field>
                <Field label="実際の距離区分">
                  <select
                    value={resolutionForm.actualDistanceId}
                    onChange={(event) =>
                      setResolutionForm((current) => ({
                        ...current,
                        actualDistanceId: event.target.value as DistanceId | "",
                      }))
                    }
                  >
                    <option value="">選択距離のまま</option>
                    {DISTANCE_ORDER.map((distanceId) => (
                      <option key={distanceId} value={distanceId}>
                        {DISTANCE_LABELS[distanceId]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="反則を付けるチーム">
                  <select
                    value={resolutionForm.foulTeam}
                    onChange={(event) =>
                      setResolutionForm((current) => ({
                        ...current,
                        foulTeam: event.target.value as Team | "",
                      }))
                    }
                  >
                    <option value="">なし</option>
                    <option value="red">{state.teams.red.name}</option>
                    <option value="blue">{state.teams.blue.name}</option>
                  </select>
                </Field>
                <Field label="失格にするチーム">
                  <select
                    value={resolutionForm.disqualifiedTeam}
                    onChange={(event) =>
                      setResolutionForm((current) => ({
                        ...current,
                        disqualifiedTeam: event.target.value as Team | "",
                      }))
                    }
                  >
                    <option value="">なし</option>
                    <option value="red">{state.teams.red.name}</option>
                    <option value="blue">{state.teams.blue.name}</option>
                  </select>
                </Field>
                <Field label="備考">
                  <textarea
                    rows={3}
                    value={resolutionForm.notes}
                    onChange={(event) =>
                      setResolutionForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <button
                onClick={handleResolveTurn}
                disabled={state.phase !== "review" && state.phase !== "active"}
                style={{ ...primaryButtonStyle("#7c3aed", state.phase !== "review" && state.phase !== "active"), marginTop: "0.9rem" }}
              >
                この内容で確定
              </button>
            </div>
          </div>
        </section>

        <section style={gridTwoStyle}>
          <div style={panelStyle}>
            <h2 style={sectionTitleStyle}>センサーとキャリブレーション</h2>
            <div style={selectionSummaryGridStyle}>
              <MetricCard
                label="最新 Raw"
                value={state.sensor.latestRaw === null ? "未取得" : String(state.sensor.latestRaw)}
              />
              <MetricCard
                label="最新 正規化"
                value={
                  state.sensor.latestNormalized === null
                    ? "未取得"
                    : `${formatScore(state.sensor.latestNormalized)}%`
                }
              />
              <MetricCard
                label="閾値"
                value={`${formatScore(state.sensor.calibration.triggerThreshold)}%`}
              />
            </div>

            <div style={{ marginTop: "1rem", display: "grid", gap: "0.8rem" }}>
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
                      current
                        ? { ...current, triggerThreshold: Number(event.target.value) }
                        : current
                    )
                  }
                />
              </Field>
            </div>

            <div style={{ ...buttonRowStyle, marginTop: "1rem" }}>
              <button
                onClick={() => runAction(() => apiClient.autoCalibrate(), "自動キャリブレーションを実行しました")}
                style={secondaryButtonStyle}
              >
                自動キャリブレーション
              </button>
              <button
                onClick={() => runAction(() => apiClient.captureCalibrationBlocked(), "遮光時の値を 0 として保存しました")}
                style={secondaryButtonStyle}
              >
                最低値を 0 に固定
              </button>
              <button
                onClick={() => runAction(() => apiClient.captureCalibrationEmpty(), "現在値を空ゴールとして保存しました")}
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
            <h2 style={sectionTitleStyle}>手動補正</h2>
            <div style={{ display: "grid", gap: "1rem" }}>
              {TEAM_ORDER.map((team) => (
                <div key={team} style={adjustRowStyle}>
                  <div>
                    <div style={{ fontWeight: 700, color: TEAM_ACCENTS[team] }}>{state.teams[team].name}</div>
                    <div style={{ color: "#cbd5e1" }}>反則数: {state.teams[team].fouls}</div>
                  </div>
                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    <button
                      onClick={() => runAction(() => apiClient.adjustFoul(team, -1), "反則数を減らしました")}
                      style={secondaryButtonStyle}
                    >
                      -1
                    </button>
                    <button
                      onClick={() => runAction(() => apiClient.adjustFoul(team, 1), "反則数を増やしました")}
                      style={secondaryButtonStyle}
                    >
                      +1
                    </button>
                  </div>
                </div>
              ))}

              <div style={{ marginTop: "0.5rem" }}>
                <div style={subheadingStyle}>ボール残数補正</div>
                <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
                  {state.balls.map((ball) => (
                    <div key={ball.id} style={adjustRowStyle}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{ball.name}</div>
                        <div style={{ color: "#cbd5e1" }}>
                          RED 残り {ball.remaining.red} / 初期 {ball.initialCount.red}
                          <br />
                          BLUE 残り {ball.remaining.blue} / 初期 {ball.initialCount.blue}
                        </div>
                      </div>
                      <div style={{ display: "grid", gap: "0.5rem" }}>
                        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                          <div style={{ minWidth: "3rem", color: TEAM_ACCENTS.red }}>RED</div>
                          <button
                            onClick={() =>
                              runAction(() => apiClient.adjustBall("red", ball.id, -1), "RED のボール残数を減らしました")
                            }
                            style={secondaryButtonStyle}
                          >
                            -1
                          </button>
                          <button
                            onClick={() =>
                              runAction(() => apiClient.adjustBall("red", ball.id, 1), "RED のボール残数を増やしました")
                            }
                            style={secondaryButtonStyle}
                          >
                            +1
                          </button>
                        </div>
                        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                          <div style={{ minWidth: "3rem", color: TEAM_ACCENTS.blue }}>BLUE</div>
                          <button
                            onClick={() =>
                              runAction(() => apiClient.adjustBall("blue", ball.id, -1), "BLUE のボール残数を減らしました")
                            }
                            style={secondaryButtonStyle}
                          >
                            -1
                          </button>
                          <button
                            onClick={() =>
                              runAction(() => apiClient.adjustBall("blue", ball.id, 1), "BLUE のボール残数を増やしました")
                            }
                            style={secondaryButtonStyle}
                          >
                            +1
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {state.phase === "finished" && (
          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>勝敗結果</h2>
            <div style={{ fontSize: "1.8rem", fontWeight: 700 }}>
              {state.winner === "draw"
                ? "延長戦が必要です"
                : `${state.teams[state.winner!].name} の勝ち`}
            </div>
            <div style={{ marginTop: "0.5rem", color: "#cbd5e1" }}>
              判定基準: {getWinnerSummary(state.winnerReason)}
            </div>
          </section>
        )}

        <section style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>他画面</h2>
              <div style={sectionHelpStyle}>運用中はチーム画面2台と全体画面1台を開いて使います。</div>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <a href="/team/red" style={linkStyle}>
                RED 画面
              </a>
              <a href="/team/blue" style={linkStyle}>
                BLUE 画面
              </a>
              <a href="/" style={linkStyle}>
                ホーム画面
              </a>
            </div>
          </div>
        </section>

        <EventLog entries={eventLog} maxEntries={20} />
      </div>
    </div>
  );
}

function buildSetupFormFromState(state: NonNullable<ReturnType<typeof useApiStore.getState>["state"]>): SetupFormState {
  const playerCount = Math.max(state.teams.red.players.length, state.teams.blue.players.length);
  const playerRows: SetupPlayerRow[] = Array.from({ length: playerCount }, (_, index) => ({
    redName: state.teams.red.players[index]?.name ?? `R${index + 1}`,
    redBasePoints: state.teams.red.players[index]?.basePoints ?? 0,
    blueName: state.teams.blue.players[index]?.name ?? `B${index + 1}`,
    blueBasePoints: state.teams.blue.players[index]?.basePoints ?? 0,
  }));

  return {
    redTeamName: state.teams.red.name,
    blueTeamName: state.teams.blue.name,
    turnDurationSec: state.turnDurationSec,
    firstThrowingTeam: state.firstThrowingTeam,
    playerRows,
    balls: state.balls.map((ball) => ({
      name: ball.name,
      initialCount: { ...ball.initialCount },
    })),
  };
}

function sumRedBasePoints(form: SetupFormState): number {
  return form.playerRows.reduce((sum, row) => sum + Number(row.redBasePoints), 0);
}

function sumBlueBasePoints(form: SetupFormState): number {
  return form.playerRows.reduce((sum, row) => sum + Number(row.blueBasePoints), 0);
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
        fontSize: "1.5rem",
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
      <div style={{ marginTop: "0.3rem", fontSize: "1.12rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function SelectionBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      style={{
        padding: "1rem",
        borderRadius: "16px",
        background: "#0f172a",
        border: "1px solid #334155",
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: "0.8rem" }}>{title}</div>
      {children}
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
  padding: "1.4rem 1.5rem",
  borderRadius: "22px",
  background: "rgba(15, 23, 42, 0.94)",
  border: "1px solid #334155",
};

const gridTwoStyle: CSSProperties = {
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
  fontSize: "1.35rem",
};

const sectionHelpStyle: CSSProperties = {
  color: "#94a3b8",
  marginTop: "0.35rem",
  fontSize: "0.92rem",
  lineHeight: 1.7,
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: "0.9rem",
  marginTop: "1rem",
};

const playerRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "48px 1.1fr 120px 1.1fr 120px 90px",
  gap: "0.75rem",
  alignItems: "center",
};

const ballRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 140px 90px",
  gap: "0.75rem",
  alignItems: "center",
};

const selectionSummaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "0.8rem",
};

const choiceGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: "0.75rem",
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: "0.75rem",
  flexWrap: "wrap",
};

const metricCardStyle: CSSProperties = {
  padding: "1rem 1.1rem",
  borderRadius: "16px",
  background: "#0f172a",
  border: "1px solid #334155",
};

const adjustRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "1rem",
  alignItems: "center",
  padding: "1rem",
  borderRadius: "14px",
  background: "#0f172a",
  border: "1px solid #334155",
};

const subheadingStyle: CSSProperties = {
  fontWeight: 700,
  fontSize: "1.05rem",
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
  padding: "0.55rem 0.7rem",
};

function choiceButtonStyle(selected: boolean, accent: string, disabled: boolean): CSSProperties {
  return {
    padding: "0.95rem 1rem",
    borderRadius: "14px",
    border: `1px solid ${selected ? accent : "#334155"}`,
    background: selected ? `${accent}22` : "#020617",
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
