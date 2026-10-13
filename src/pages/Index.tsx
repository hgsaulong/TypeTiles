import { useEffect, useRef, useState } from "react";
import { CheckCheck, ChevronDown, Star, Zap, type LucideIcon } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { mockMatchConfig, type GreggSubmode } from "../lib/mockData";
import { usePlayerAuth } from "../lib/PlayerAuthContext";
import { getPlayerHistory, getPlayerRank, type MatchHistoryRow, type PlayerStats } from "../lib/playerApi";
import { getProfileAvatar, getProfileBackground } from "../lib/profileAssets";

const assetRoot = "/figma/type-tiles-home";

const categories = [
  { label: "CORPORATE", image: `${assetRoot}/image4.png`, dimmed: true },
  { label: "COMMUNICATION", image: `${assetRoot}/image5.png` },
  { label: "RECORDS", image: `${assetRoot}/image6.png`, dimmed: true },
  { label: "ACCOUNTING", image: `${assetRoot}/image7.png`, dimmed: true },
  { label: "TECHNOLOGY", image: `${assetRoot}/image8.png`, dimmed: true },
  { label: "GENERAL",image: `${assetRoot}/general_bg.jpg`, dimmed: true },
  { label: "STENOGRAPHY", image: `${assetRoot}/stenography_bg.jpg`, dimmed: true },
  { label: "MEDICAL", image: `${assetRoot}/medical_bg.jpg`, dimmed: true },
  { label: "LEGAL", image: `${assetRoot}/legal_bg.jpg`, dimmed: true },
] as const;

const difficultyOptions = ["Easy", "Normal", "Hard"] as const;
const durationOptions = [30, 60, 90] as const;
const fallingTextOptions = [
  { value: "word-phrase", label: "Word / Phrase" },
  { value: "full-sentence", label: "Full Sentence" },
] as const;

type CategoryLabel = (typeof categories)[number]["label"];
type PlayableCategory = Exclude<CategoryLabel, "COMING SOON">;
type DifficultyLabel = (typeof difficultyOptions)[number];

function HomeStatIcon({ icon: Icon, alt }: { icon: LucideIcon; alt: string }) {
  return <Icon aria-label={alt} className="h-[26px] w-[26px] shrink-0 text-sky-500" />;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [greggSubmode, setGreggSubmode] = useState<GreggSubmode>("full-sentence");
  const { user, stats: restoredStats } = usePlayerAuth();
  const [dashboardStats, setDashboardStats] = useState<PlayerStats | null>(restoredStats);
  const [latestMatch, setLatestMatch] = useState<MatchHistoryRow | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [statsError, setStatsError] = useState("");

  useEffect(() => {
    Promise.all([getPlayerRank(), getPlayerHistory()])
      .then(([rankResponse, historyResponse]) => {
        setDashboardStats(rankResponse.stats);
        setRank(rankResponse.rank);
        setLatestMatch(historyResponse.history[0] ?? null);
      })
      .catch((error) => setStatsError(error instanceof Error ? error.message : "Unable to load stats"));
  }, []);

  const statItems = [
    { icon: Zap, label: "Best WPM", value: dashboardStats ? dashboardStats.best_wpm.toFixed(1) : "...", valueClassName: "text-white" },
    { icon: CheckCheck, label: "Accuracy", value: dashboardStats ? `${dashboardStats.avg_accuracy.toFixed(1)}%` : "...", valueClassName: "text-emerald-400" },
    { icon: Star, label: "Max Combo", value: dashboardStats ? String(dashboardStats.top_combo) : "...", valueClassName: "text-amber-300" },
  ] as const;
  const [selectedCategory, setSelectedCategory] = useState<PlayableCategory | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<DifficultyLabel>("Normal");
  const [selectedDuration, setSelectedDuration] = useState<(typeof durationOptions)[number]>(90);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const [comingSoonNote, setComingSoonNote] = useState(false);
  const comingSoonTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(comingSoonTimer.current), []);

  const openProfileModal = () => {
    navigate("/app/customize");
  };

  const showComingSoonNote = () => {
    setComingSoonNote(true);
    window.clearTimeout(comingSoonTimer.current);
    comingSoonTimer.current = window.setTimeout(() => setComingSoonNote(false), 3600);
  };

  const openCategoryPicker = () => {
    setSelectedCategory((current) => current ?? "CORPORATE");
    setSelectedDifficulty("Normal");
    setSelectedDuration(90);
    setCategoryDropdownOpen(false);
  };

  const handleStartFromCategory = () => {
    if (!selectedCategory) return;

    navigate("/app/pre-match", {
      state: {
        matchConfig: {
          ...mockMatchConfig,
          wordSet: selectedCategory,
          mode: "Solo Practice",
          difficulty: selectedDifficulty,
          roundTime: selectedDuration,
          opponents: [],
          greggSubmode,
        },
      },
    });
  };

  const categoryPreview = categories.find((category) => category.label === selectedCategory);
  const selectedCategoryLabel = selectedCategory
    ? selectedCategory.charAt(0) + selectedCategory.slice(1).toLowerCase()
    : "";
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden pb-4">
      <h1 className="shrink-0 px-1 text-[1.95rem] font-semibold tracking-[-0.03em] text-white sm:text-[2.15rem]">Welcome to Type Tiles!</h1>

      <article
        className="mt-4 shrink-0 rounded-[10px] border border-[#3d3d3d]/70 bg-[#c3d9ed] bg-cover bg-center px-4 py-3 text-slate-900 shadow-[0_20px_50px_rgba(5,8,24,0.35)]"
        style={{ backgroundImage: `linear-gradient(rgba(195,217,237,.84), rgba(195,217,237,.84)), url(${getProfileBackground(user?.background).source})` }}
      >
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="h-[84px] w-[88px] shrink-0 overflow-hidden rounded-[9px] bg-[#4186c0]">
                <img alt={`${getProfileAvatar(user?.avatar).label} avatar`} className="h-full w-full object-cover object-[center_top]" src={getProfileAvatar(user?.avatar).source} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-[0.7rem] uppercase tracking-[0.16em] text-[#3d3d3d]">{user?.role === "teacher" ? "Teacher" : "Player"}</div>
                <div className="mt-1 truncate text-[1.85rem] font-semibold leading-none tracking-[-0.03em] text-black">{user?.displayName || user?.username || "Player"}</div>
                <div className="mt-3 text-[0.68rem] uppercase tracking-[0.12em] text-[#3d3d3d]">
                  {rank !== null ? `Rank # ${rank} Global` : "Rank unavailable"}
                </div>
              </div>

              <div className="hidden min-w-[180px] shrink-0 text-right sm:block">
                <button
                  type="button"
                  onClick={openProfileModal}
                  className="mt-3 w-[180px] rounded-[7px] bg-[#1a2045] py-2 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition hover:brightness-110"
                >
                  Edit Profile
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={openProfileModal}
              className="mt-3 w-full rounded-[7px] bg-[#1a2045] px-4 py-2 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition hover:brightness-110 sm:hidden"
            >
              Edit Profile
            </button>
      </article>

      <div className="mt-4 grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden lg:grid-cols-[321px_minmax(0,1fr)] lg:grid-rows-1 xl:gap-[35px]">
        <div className="min-h-0 space-y-4">
          <button
            type="button"
            onClick={openCategoryPicker}
            className="flex h-[50px] w-full items-center justify-center rounded-[8px] border border-[#bde9ff] bg-[#7357f1] px-6 text-[1rem] font-medium text-white shadow-[0_14px_30px_rgba(80,63,220,0.35)] transition hover:brightness-110"
          >
            Start Game
          </button>
          {user?.role === "teacher" ? (
            <Link
              to="/app/lobby"
              className="flex h-[50px] w-full items-center justify-center rounded-[8px] border border-[#bde9ff] bg-[#7357f1] px-6 text-[1rem] font-medium text-white shadow-[0_14px_30px_rgba(80,63,220,0.35)] transition hover:brightness-110"
            >
              Create Classroom
            </Link>
          ) : null}
          <article className="rounded-[10px] border border-[#2967a1] bg-[#1d234a] p-4 shadow-[0_16px_30px_rgba(4,8,25,0.35)]">
            <div className="space-y-4">
              {statItems.map((item) => (
                <div key={item.label} className="grid grid-cols-[28px_1fr_auto] items-center gap-3">
                  <HomeStatIcon alt={item.label} icon={item.icon} />
                  <div className="text-[1.05rem] font-medium text-white">{item.label}</div>
                  <div className={`text-[1.35rem] font-semibold tracking-[-0.04em] ${item.valueClassName}`}>{item.value}</div>
                </div>
              ))}
            </div>
            {statsError ? <div className="mt-3 text-xs text-amber-300">{statsError}</div> : null}
          </article>

          <article className="relative overflow-hidden rounded-[10px] border border-[#2967a1] bg-[#1a2349] p-4 shadow-[0_16px_30px_rgba(4,8,25,0.35)]">
            <div className="text-[1.1rem] font-medium text-white">Last Transmission</div>
            {latestMatch ? <>
              <div className="mt-2 flex items-end gap-3">
                <div className="text-[3rem] font-semibold leading-none tracking-[-0.06em] text-white">{latestMatch.wpm.toFixed(1)}</div>
                <div className="pb-1 text-sm uppercase tracking-[0.16em] text-white/90">WPM</div>
              </div>
              <div className="mt-3 text-[0.75rem] uppercase tracking-[0.18em] text-white/90">
                {latestMatch.mode} <span className="mx-2 text-white/55">{new Date(latestMatch.created_at).toLocaleDateString()}</span>
              </div>
            </> : <div className="mt-3 text-sm text-white/70">No completed matches yet.</div>}
            <img alt="" className="pointer-events-none absolute -bottom-2 right-1 h-[74px] w-[98px] opacity-70" src={`${assetRoot}/cloud9.png`} />
            <img alt="" className="pointer-events-none absolute -bottom-2 right-6 h-[80px] w-[74px] opacity-90" src={`${assetRoot}/cloud10.png`} />
          </article>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="grid gap-[10px] sm:grid-cols-2 xl:grid-cols-3">
            {categories.map((category, index) => (
              <button
                type="button"
                key={`${category.label}-${index}`}
                onClick={() => {
                  if ("unavailable" in category && category.unavailable) {
                    showComingSoonNote();
                    return;
                  }
                  setSelectedCategory(category.label as PlayableCategory);
                  setSelectedDifficulty("Normal");
                }}
                className="relative aspect-[4/3] overflow-hidden rounded-[8px] border-2 border-[#1183bb] bg-[#1a2349] text-left shadow-[0_16px_30px_rgba(4,8,25,0.35)] transition hover:scale-[1.01] hover:border-sky-300 xl:aspect-[1/1]"
              >
                {"solid" in category ? (
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(70,62,191,0.95)_0%,rgba(47,35,149,0.95)_100%)]" />
                ) : (
                  <img alt="" className={`absolute inset-0 h-full w-full object-cover ${"dimmed" in category ? "opacity-60" : ""}`} src={category.image} />
                )}
                {"dimmed" in category && !("solid" in category) ? <div className="absolute inset-0 bg-black/25" /> : null}
                {category.label !== "GENERAL" ? <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/10" /> : null}

                <div className="absolute inset-0 flex items-center justify-center px-4 text-center">
                  <div className="max-w-full font-['Concert_One'] text-[1.8rem] leading-none tracking-[0.04em] text-white drop-shadow-[0_4px_10px_rgba(0,0,0,0.35)] sm:text-[1.95rem]">
                    {category.label}
                  </div>
                </div>

              </button>
            ))}
            </div>
          </div>
        </div>
      </div>

      {comingSoonNote ? (
        <div role="status" className="fixed bottom-5 left-1/2 z-[60] w-[min(92vw,440px)] -translate-x-1/2 rounded-lg border border-sky-300/70 bg-[#101a35]/95 px-5 py-4 text-center text-white shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur">
          <div className="font-semibold text-sky-200">Coming Soon!</div>
          <div className="mt-1 text-sm text-white/85">This category is currently unavailable. Stay tuned for more updates!</div>
        </div>
      ) : null}

      {selectedCategory ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-[2px]">
          <div className="scrollbar-hidden max-h-[92vh] w-full max-w-[680px] overflow-y-auto rounded-[12px] border border-[#5da3c5] bg-[#13173b] shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
            <div className="h-[84px] w-full overflow-hidden">
              <img alt="" className="h-full w-full object-cover" src={categoryPreview && "image" in categoryPreview ? categoryPreview.image : `${assetRoot}/image5.png`} />
            </div>

            <div className="px-8 py-3">
              <div className="flex items-center gap-3 text-white/90">
                <span className="whitespace-nowrap font-['Roboto'] text-[1.35rem] font-bold tracking-[0.02em]">CATEGORY</span>
                <div className="h-px flex-1 bg-white/70" />
              </div>

              <div className="relative mt-3">
                <button
                  type="button"
                  aria-expanded={categoryDropdownOpen}
                  onClick={() => setCategoryDropdownOpen((open) => !open)}
                  className="flex min-h-[38px] w-full items-center justify-between rounded-[8px] border-[3px] border-[#76a9bc] bg-[#343c83] px-4 text-center font-semibold text-white/85 transition hover:border-sky-300"
                >
                  <span className="flex-1">{selectedCategoryLabel}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-5 w-5 shrink-0 transition-transform ${categoryDropdownOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {categoryDropdownOpen ? (
                  <div className="scrollbar-hidden absolute left-0 right-0 top-[calc(100%+4px)] z-10 max-h-60 overflow-y-auto rounded-[8px] border-2 border-[#76a9bc] bg-[#343c83] p-1 shadow-[0_12px_24px_rgba(0,0,0,0.35)]">
                    {categories.map((category) => (
                      <button
                        key={category.label}
                        type="button"
                        onClick={() => {
                          setSelectedCategory(category.label);
                          setCategoryDropdownOpen(false);
                        }}
                        className={`block w-full rounded-[6px] px-3 py-1.5 text-left font-semibold text-white/85 transition hover:bg-[#252d70] ${category.label === selectedCategory ? "bg-[#151c58]" : ""}`}
                      >
                        {category.label.charAt(0) + category.label.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex items-center gap-3 text-white/90">
                <span className="whitespace-nowrap font-['Roboto'] text-[1.35rem] font-bold tracking-[0.02em]">DIFFICULTY</span>
                <div className="h-px flex-1 bg-white/70" />
              </div>

              <div className="mt-2 grid grid-cols-3 gap-3">
                {difficultyOptions.map((difficulty) => (
                  <button
                    key={difficulty}
                    type="button"
                    onClick={() => setSelectedDifficulty(difficulty)}
                    className={`min-h-[38px] rounded-[8px] border-[3px] px-2 py-1 text-base font-bold transition ${selectedDifficulty === difficulty ? "border-[#76a9bc] bg-[#343c83] text-white" : "border-[#76a9bc] bg-[#080f47] text-white/85"}`}
                  >
                    {difficulty}
                  </button>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-3 text-white/90">
                <span className="whitespace-nowrap font-['Roboto'] text-[1.35rem] font-bold tracking-[0.02em]">FALLING TEXT TYPE</span>
                <div className="h-px flex-1 bg-white/70" />
              </div>

              <div className="mt-2 grid grid-cols-2 gap-3">
                {fallingTextOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setGreggSubmode(option.value)}
                    className={`min-h-[38px] rounded-[8px] border-[3px] px-2 py-1 text-sm font-bold transition sm:text-base ${greggSubmode === option.value ? "border-[#76a9bc] bg-[#343c83] text-white" : "border-[#76a9bc] bg-[#080f47] text-white/85"}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {greggSubmode === "full-sentence" ? <p className="mt-2 px-1 text-xs text-white/45">Full sentence falls slower. Type the complete sentence, including spaces and punctuation.</p> : null}

              <div className="mt-3 flex items-center gap-3 text-white/90">
                <span className="whitespace-nowrap font-['Roboto'] text-[1.35rem] font-bold tracking-[0.02em]">DURATION</span>
                <div className="h-px flex-1 bg-white/70" />
              </div>

              <div className="mt-2 grid grid-cols-3 gap-3">
                {durationOptions.map((duration) => (
                  <button
                    key={duration}
                    type="button"
                    onClick={() => setSelectedDuration(duration)}
                    className={`min-h-[38px] rounded-[8px] border-[3px] px-2 py-1 text-base font-bold transition ${selectedDuration === duration ? "border-[#76a9bc] bg-[#343c83] text-white" : "border-[#76a9bc] bg-[#080f47] text-white/85"}`}
                  >
                    {duration}s
                  </button>
                ))}
              </div>

              <div className="mt-4 flex justify-center gap-3 pb-1">
                <button
                  type="button"
                  onClick={handleStartFromCategory}
                  className="order-1 min-w-0 flex-1 rounded-[8px] border-[3px] border-[#76a9bc] bg-[#2389aa] px-4 py-2 font-bold text-white sm:min-w-[268px]"
                >
                  Start Game
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCategory(null)}
                  className="order-2 min-w-0 flex-1 rounded-[8px] border-[3px] border-[#76a9bc] bg-transparent px-4 py-2 text-white sm:min-w-[268px]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
