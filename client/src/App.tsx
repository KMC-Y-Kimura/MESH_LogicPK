import { useEffect, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import OperatorPage from "./pages/OperatorPage";
import TeamPage from "./pages/TeamPage";
import DisplayPage from "./pages/DisplayPage";
import { useRealtimeStore } from "./api/realtime";
import { apiClient, useApiStore } from "./api/client";
import { AudioCueController } from "./components/AudioCueController";

function App() {
  const [initialized, setInitialized] = useState(false);
  const [initError, setInitError] = useState<string>("");
  const connect = useRealtimeStore((state) => state.connect);
  const updateState = useApiStore((state) => state.updateState);
  const currentState = useApiStore((state) => state.state);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      connect();
      try {
        const state = await apiClient.getState();
        if (!cancelled) {
          updateState(state);
        }
      } catch (error) {
        console.error("Failed to fetch initial state:", error);
        if (!cancelled) {
          setInitError("初期状態の取得に失敗しました。サーバー接続を確認してください。");
        }
      } finally {
        if (!cancelled) {
          setInitialized(true);
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [connect, updateState]);

  if (!initialized) {
    return <div style={{ padding: "2rem", textAlign: "center" }}>初期状態を取得中...</div>;
  }

  return (
    <Router>
      <AudioCueController />
      {initError && (
        <div
          style={{
            position: "fixed",
            top: 16,
            left: 16,
            right: 16,
            zIndex: 1000,
            padding: "0.75rem 1rem",
            background: "#552222",
            border: "1px solid #ff6666",
            borderRadius: "6px",
            color: "#ffd0d0",
          }}
        >
          {initError}
        </div>
      )}
      <Routes>
        <Route path="/" element={<DisplayPage />} />
        <Route
          path="/team/red"
          element={currentState?.phase === "setup" ? <OperatorPage /> : <TeamPage team="red" />}
        />
        <Route path="/team/blue" element={<TeamPage team="blue" />} />
        <Route path="/display" element={<Navigate to="/" replace />} />
        <Route path="/results" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
