import { Plus, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePlayerAuth } from "../lib/PlayerAuthContext";
import { getProfileAvatar, getProfileBackground, PROFILE_AVATARS, PROFILE_BACKGROUNDS, type ProfileAvatarId, type ProfileBackgroundId } from "../lib/profileAssets";

const avatars = Object.entries(PROFILE_AVATARS).map(([id, avatar]) => ({ id: id as ProfileAvatarId, ...avatar }));
const backgrounds = Object.entries(PROFILE_BACKGROUNDS).map(([id, background]) => ({ id: id as ProfileBackgroundId, ...background }));

type AvatarId = ProfileAvatarId | string;
type BackgroundId = ProfileBackgroundId;
type ProfileTab = "avatar" | "background";

function validAvatar(value: string | undefined): AvatarId {
  return value?.startsWith("data:image/") || avatars.some((avatar) => avatar.id === value) ? value as AvatarId : "hani";
}

function validBackground(value: string | undefined): BackgroundId {
  return backgrounds.some((background) => background.id === value) ? (value as BackgroundId) : "blues";
}

export default function Customize() {
  const navigate = useNavigate();
  const { user, updateProfile } = usePlayerAuth();
  const [tab, setTab] = useState<ProfileTab>("avatar");
  const [displayName, setDisplayName] = useState(user?.displayName || user?.username || "Player");
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarId>(validAvatar(user?.avatar));
  const [selectedBackground, setSelectedBackground] = useState<BackgroundId>(validBackground(user?.background));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDisplayName(user?.displayName || user?.username || "Player");
    setSelectedAvatar(validAvatar(user?.avatar));
    setSelectedBackground(validBackground(user?.background));
  }, [user?.avatar, user?.background, user?.displayName, user?.username]);

  const currentAvatar = getProfileAvatar(selectedAvatar);
  const currentBackground = getProfileBackground(selectedBackground);

  const applyChanges = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await updateProfile({ displayName: displayName.trim(), avatar: selectedAvatar, background: selectedBackground });
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save profile");
    } finally {
      setSaving(false);
    }
  };

  const selectCustomAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file.");
      return;
    }
    if (file.size > 1_500_000) {
      setError("Choose an image smaller than 1.5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setSelectedAvatar(reader.result);
        setSaved(false);
        setError("");
      }
    };
    reader.onerror = () => setError("Unable to read that image.");
    reader.readAsDataURL(file);
  };

  return (
    <section className="h-full overflow-y-auto pb-6" data-node-id="423:2672">
      <div className="relative min-h-[735px] rounded-[8px] bg-[linear-gradient(197deg,#08122e_17%,rgba(43,51,89,.9)_46%,#13173b_81%)] px-4 py-6 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => navigate("/app/settings")}
          className="absolute right-5 top-5 rounded-full p-2 text-white transition hover:bg-white/10"
          aria-label="Open settings"
        >
          <Settings className="h-7 w-7" />
        </button>

        <div className="mx-auto max-w-[998px] pt-12 lg:pt-0">
          <div
            className="relative flex h-[196px] items-center justify-center rounded-[8px] border border-[#2967a1] bg-[#0a1325]/70"
            style={{ backgroundImage: `linear-gradient(rgba(22,43,82,.5), rgba(13,27,58,.7)), url(${currentBackground.source})`, backgroundSize: "cover", backgroundPosition: "center" }}
          >
            <div className="relative">
              <img alt={`${currentAvatar.label} avatar preview`} src={currentAvatar.source} className="h-[150px] w-[150px] rounded-full object-cover" />
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="absolute bottom-2 right-[-12px] flex h-11 w-11 items-center justify-center rounded-full border-4 border-[#0a1325] bg-[#2746a6] text-white shadow-lg transition hover:bg-[#3960cf] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8db0ff]"
                aria-label="Upload a custom profile photo"
                title="Upload a custom profile photo"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>

          {user?.role === "student" && (
            <Link to="/app/word-bank" className="my-4 inline-flex rounded-[8px] border border-[#2967a1] bg-[#2746a6] px-5 py-3 font-medium text-white transition hover:bg-[#233f9d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#6a9eff]">
              Word Bank
            </Link>
          )}

          <div className="mt-2 flex h-[59px] rounded-[8px] border border-[#2967a1] bg-[#1d234a]">
            <button type="button" onClick={() => setTab("avatar")} className={`relative flex-1 rounded-[8px] text-[18px] font-medium text-white ${tab === "avatar" ? "bg-[rgba(23,54,112,.7)] after:absolute after:bottom-[-8px] after:left-0 after:right-0 after:h-2 after:rounded-[8px] after:bg-[#6a9eff]" : ""}`} aria-selected={tab === "avatar"}>AVATAR</button>
            <button type="button" onClick={() => setTab("background")} className={`relative flex-1 rounded-[8px] text-[18px] font-medium text-white ${tab === "background" ? "bg-[rgba(23,54,112,.7)] after:absolute after:bottom-[-8px] after:left-0 after:right-0 after:h-2 after:rounded-[8px] after:bg-[#6a9eff]" : ""}`} aria-selected={tab === "background"}>BACKGROUND</button>
          </div>

          <div className="mt-0 min-h-[198px] rounded-[8px] border-x border-b border-[#2967a1] bg-[#0a1325]/70 p-4 sm:p-5">
            {tab === "avatar" ? (
              <>
                <div className="text-[18px] font-medium text-white">CHOOSE AVATAR</div>
                <div className="mt-7 grid grid-cols-2 gap-4 sm:grid-cols-5">
                  <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={selectCustomAvatar} className="hidden" />
                  {avatars.map((avatar) => (
                    <button key={avatar.id} type="button" onClick={() => { setSelectedAvatar(avatar.id); setSaved(false); }} className={`relative flex h-[112px] items-center justify-center rounded-[7px] border p-2 transition ${selectedAvatar === avatar.id ? "border-[#6a9eff] bg-[#2b3359]" : "border-transparent bg-[rgba(43,51,89,.9)] hover:border-[#6a9eff]/60"}`} aria-pressed={selectedAvatar === avatar.id}>
                      <img alt={avatar.label} src={avatar.source} className="h-[104px] w-[104px] rounded-full object-cover" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="text-[18px] font-medium text-white">CHOOSE BACKGROUND</div>
                <div className="mt-5 grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
                  {backgrounds.map((background) => (
                    <button key={background.id} type="button" onClick={() => { setSelectedBackground(background.id); setSaved(false); }} className={`h-[104px] overflow-hidden rounded-[7px] border-2 transition ${selectedBackground === background.id ? "border-[#6a9eff]" : "border-transparent"}`} aria-pressed={selectedBackground === background.id}>
                      <img alt={background.label} src={background.source} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <label className="sr-only" htmlFor="profile-display-name">Display name</label>
          <input id="profile-display-name" value={displayName} onChange={(event) => { setDisplayName(event.target.value); setSaved(false); }} className="sr-only" />

          <button type="button" onClick={applyChanges} disabled={saving || !displayName.trim()} className="mx-auto mt-9 block h-[59px] w-full max-w-[537px] rounded-[8px] bg-[#2746a6] text-[24px] font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? "Saving..." : "Apply Changes"}
          </button>
          {saved ? <div className="mt-3 text-center text-sm text-emerald-300">Profile changes saved.</div> : null}
          {error ? <div className="mt-3 text-center text-sm text-amber-300">{error}</div> : null}
        </div>
      </div>
    </section>
  );
}
