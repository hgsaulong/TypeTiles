import haniAvatar from "../assets/avatars/ptc_hani.png";
import helenAvatar from "../assets/avatars/ptc_helen.png";
import jacqAvatar from "../assets/avatars/ptc_jacq.png";
import kylaAvatar from "../assets/avatars/ptc_kyla.png";
import liscanoAvatar from "../assets/avatars/ptc_liscano.png";
import bluesBackground from "../assets/backround/blues.png";
import cityBackground from "../assets/backround/city.jpg";
import officeBackground from "../assets/backround/office.jpg";
import voltsBackground from "../assets/backround/volts.png";

export const PROFILE_AVATARS = {
  hani: { source: haniAvatar, label: "Hani" },
  helen: { source: helenAvatar, label: "Helen" },
  jacq: { source: jacqAvatar, label: "Jacq" },
  kyla: { source: kylaAvatar, label: "Kyla" },
  liscano: { source: liscanoAvatar, label: "Liscano" },
} as const;

export const PROFILE_BACKGROUNDS = {
  blues: { source: bluesBackground, label: "Blues" },
  volts: { source: voltsBackground, label: "Volts" },
  office: { source: officeBackground, label: "Office" },
  city: { source: cityBackground, label: "City" },
} as const;

export type ProfileAvatarId = keyof typeof PROFILE_AVATARS;
export type ProfileBackgroundId = keyof typeof PROFILE_BACKGROUNDS;

export function getProfileAvatar(value: string | undefined): { source: string; label: string } {
  if (value?.startsWith("data:image/")) {
    return { source: value, label: "Custom avatar" };
  }
  return PROFILE_AVATARS[value as ProfileAvatarId] ?? PROFILE_AVATARS.hani;
}

export function getProfileBackground(value: string | undefined) {
  return PROFILE_BACKGROUNDS[value as ProfileBackgroundId] ?? PROFILE_BACKGROUNDS.blues;
}
