import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import { AppShell } from "./components/AppShell";
import PlayerAuth from "./components/PlayerAuth";
import ForgotPassword from "./pages/ForgotPassword";
import VerifyEmail from "./pages/VerifyEmail";
import { mockMatchConfig } from "./lib/mockData";
import { usePlayerAuth } from "./lib/PlayerAuthContext";
import Achievements from "./pages/Achievements";
import Customize from "./pages/Customize";
import WordBank from "./pages/WordBank";
import Dashboard from "./pages/Index";
import Loading from "./pages/Loading";
import Welcome from "./pages/Welcome";
import Friends from "./pages/Friends";
import Game from "./pages/Game";
import History from "./pages/History";
import Leaderboard from "./pages/Leaderboard";
import Lobby from "./pages/Lobby";
import Play from "./pages/Play";
import PreMatch from "./pages/PreMatch";
import Results from "./pages/Results";
import Settings, { AboutTypeTiles, AccountSettings, FeedbackPage, HelpSupport, NotificationSettings } from "./pages/Settings";

function GameRoute() {
  const location = useLocation();
  const state = location.state as {
    mode?: "solo" | "multiplayer";
    roomCode?: string;
    hostAddress?: string;
    matchConfig?: typeof mockMatchConfig;
    matchId?: number;
    wordSequence?: string[];
    startAt?: number;
    background?: string;
  } | null;

  return (
    <Game
      mode={state?.mode ?? "solo"}
      roomCode={state?.roomCode}
      hostAddress={state?.hostAddress}
      matchConfig={state?.matchConfig ?? mockMatchConfig}
      matchId={state?.matchId}
      wordSequence={state?.wordSequence}
      startAt={state?.startAt}
      backgroundId={state?.background}
    />
  );
}

function DashboardRoute() {
  return <Dashboard />;
}

function ProtectedApp() {
  const location = useLocation();
  const { user, isLoading } = usePlayerAuth();

  if (isLoading) {
    return <div className="min-h-screen bg-slate-900 text-white" />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <AppShell />;
}

function StudentWordBankRoute() {
  const { user } = usePlayerAuth();
  return user?.role === "student" ? <WordBank /> : <Navigate to="/app" replace />;
}

const DevGreggCropEditor = import.meta.env.DEV ? lazy(() => import("./data/dev/GreggCropEditor")) : null;
const DevGreggExercise6Pilot = import.meta.env.DEV ? lazy(() => import("./data/dev/GreggExercise6Pilot")) : null;

export default function App() {
  return (
    <Routes>
      {import.meta.env.DEV && DevGreggCropEditor && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) && (
        <Route path="/dev/gregg-crops" element={<Suspense fallback={<div className="p-6 text-white">Loading crop editor...</div>}><DevGreggCropEditor /></Suspense>} />
      )}
      <Route path="/" element={<Loading />} />
      <Route path="/welcome" element={<Welcome />} />
      <Route path="/login" element={<PlayerAuth />} />
      <Route path="/register" element={<PlayerAuth />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />

      <Route path="/app/*" element={<ProtectedApp />}>
        {import.meta.env.DEV && DevGreggExercise6Pilot && ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) && (
          <Route path="dev/gregg-exercise-6" element={<Suspense fallback={<div>Loading pilot...</div>}><DevGreggExercise6Pilot /></Suspense>} />
        )}
        <Route index element={<DashboardRoute />} />
        <Route path="play" element={<Play />} />
        <Route path="lobby" element={<Lobby />} />
        <Route path="pre-match" element={<PreMatch />} />
        <Route path="game" element={<GameRoute />} />
        <Route path="results" element={<Results />} />
        <Route path="history" element={<History />} />
        <Route path="customize" element={<Customize />} />
        <Route path="word-bank" element={<StudentWordBankRoute />} />
        <Route path="leaderboard" element={<Leaderboard />} />
        <Route path="achievements" element={<Achievements />} />
        <Route path="friends" element={<Friends />} />
        <Route path="settings" element={<Settings />} />
        <Route path="settings/account" element={<AccountSettings />} />
        <Route path="settings/notifications" element={<NotificationSettings />} />
        <Route path="settings/help" element={<HelpSupport />} />
        <Route path="settings/about" element={<AboutTypeTiles />} />
        <Route path="settings/feedback" element={<FeedbackPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
