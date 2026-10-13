import Phaser from "phaser";
import { useEffect, useRef } from "react";
import MatchHudScene from "../scenes/match_hud";
import type { MatchConfig } from "../lib/mockData";
import type { GamePerformance, GameResult } from "../scenes/GameScene";

type Props = {
  mode?: "solo" | "multiplayer";
  roomCode?: string;
  matchConfig: MatchConfig;
  backgroundImage?: string;
  onGameOver: (result: GameResult) => void;
  onRestart?: () => void;
  onExit?: () => void;
  onPerformance?: (performance: GamePerformance) => void;
  wordSequence?: string[];
  startAt?: number;
};

export function GameMount({ mode = "solo", roomCode, matchConfig, backgroundImage, onGameOver, onRestart, onExit, onPerformance, wordSequence, startAt }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onGameOverRef = useRef(onGameOver);
  const onRestartRef = useRef(onRestart);
  const onExitRef = useRef(onExit);
  const onPerformanceRef = useRef(onPerformance);

  useEffect(() => {
    onGameOverRef.current = onGameOver;
  }, [onGameOver]);

  useEffect(() => {
    onRestartRef.current = onRestart;
  }, [onRestart]);

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    onPerformanceRef.current = onPerformance;
  }, [onPerformance]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Create the Phaser game without automatically starting a scene.
    // We start GameScene manually below so we can pass matchConfig to it.
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      transparent: true,
      backgroundColor: "#000000",
      width: host.clientWidth,
      height: host.clientHeight,
      scene: [],
      scale: {
        mode: Phaser.Scale.RESIZE,
      },
      render: {
        antialias: true,
        pixelArt: false,
      },
    });

    // Add and start the Phaser scene.
    // matchConfig is passed to GameScene.init().
    game.scene.add("GameScene", MatchHudScene, true, {
      mode,
      roomCode,
      matchConfig,
      onGameOver: (result: GameResult) => onGameOverRef.current(result),
      onRestart: () => onRestartRef.current?.(),
      onExit: () => onExitRef.current?.(),
      onPerformance: (performance: GamePerformance) => onPerformanceRef.current?.(performance),
      wordSequence,
      startAt,
    });

    // Keep the Phaser canvas responsive when the window changes size.
    const resize = () => {
      game.scale.resize(host.clientWidth, host.clientHeight);
    };

    window.addEventListener("resize", resize);

    // Clean up Phaser and the event listener when leaving the game page.
    return () => {
      window.removeEventListener("resize", resize);
      game.destroy(true);
    };
  }, [matchConfig, mode, roomCode, startAt, wordSequence]);

  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden bg-black/30 bg-cover bg-center"
      style={backgroundImage ? { backgroundImage: `linear-gradient(rgba(25, 48, 91, 0.12), rgba(12, 25, 56, 0.18)), url("${backgroundImage}")` } : undefined}
    >
      <div
        ref={hostRef}
        className="game-stage h-full min-h-0 w-full"
      />
    </div>
  );
}