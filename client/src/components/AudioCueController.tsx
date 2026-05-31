import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useApiStore } from "../api/client";

type CueName = "start" | "warning" | "end";

const AUDIO_FILES: Record<CueName, string> = {
  start: "/audio/frc-start-sound.mp3",
  warning: "/audio/frc-warning.mp3",
  end: "/audio/frc-end.mp3",
};

export function AudioCueController() {
  const location = useLocation();
  const state = useApiStore((store) => store.state);
  const audioMapRef = useRef<Record<CueName, HTMLAudioElement> | null>(null);
  const previousPhaseRef = useRef<string | null>(null);
  const warningPlayedTurnRef = useRef<number | null>(null);

  const isOperatorPage = location.pathname === "/team/red" || location.pathname === "/";

  useEffect(() => {
    const audioMap = {
      start: new Audio(AUDIO_FILES.start),
      warning: new Audio(AUDIO_FILES.warning),
      end: new Audio(AUDIO_FILES.end),
    };

    Object.values(audioMap).forEach((audio) => {
      audio.preload = "auto";
    });

    audioMapRef.current = audioMap;

    return () => {
      Object.values(audioMap).forEach((audio) => {
        audio.pause();
        audio.src = "";
      });
      audioMapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const audioMap = audioMapRef.current;
    if (!audioMap) {
      return;
    }

    const unlockAudio = () => {
      const audio = audioMap.start;
      audio.muted = true;
      void audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        })
        .catch(() => {
          audio.muted = false;
        });
    };

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useEffect(() => {
    if (!state || !isOperatorPage) {
      return;
    }

    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = state.phase;

    if (previousPhase !== "active" && state.phase === "active") {
      warningPlayedTurnRef.current = null;
      playCue("start", audioMapRef.current);
    }

    if (previousPhase === "active" && (state.phase === "review" || state.phase === "finished")) {
      playCue("end", audioMapRef.current);
    }

    if (state.phase !== "active") {
      warningPlayedTurnRef.current = null;
    }
  }, [isOperatorPage, state]);

  useEffect(() => {
    if (
      !isOperatorPage ||
      !state ||
      state.phase !== "active" ||
      !state.currentTurn?.startedAt ||
      state.activeDurationSec <= 30
    ) {
      return;
    }

    const turnId = state.currentTurn.startedAt;
    if (warningPlayedTurnRef.current !== null && warningPlayedTurnRef.current !== turnId) {
      warningPlayedTurnRef.current = null;
    }

    const intervalId = window.setInterval(() => {
      const remainingMs = state.activeDurationSec * 1000 - (Date.now() - turnId);
      const remainingSec = Math.ceil(remainingMs / 1000);

      if (remainingSec <= 30 && warningPlayedTurnRef.current !== turnId) {
        warningPlayedTurnRef.current = turnId;
        playCue("warning", audioMapRef.current);
      }
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isOperatorPage, state?.phase, state?.activeDurationSec, state?.currentTurn?.startedAt]);

  return null;
}

function playCue(name: CueName, audioMap: Record<CueName, HTMLAudioElement> | null) {
  const audio = audioMap?.[name];
  if (!audio) {
    return;
  }

  audio.pause();
  audio.currentTime = 0;
  void audio.play().catch((error) => {
    console.warn(`Failed to play audio cue: ${name}`, error);
  });
}
