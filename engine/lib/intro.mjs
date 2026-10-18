// Which series intro an episode gets: shotlist "intro": "day"|"night", else night if scene 1 is lit for night.
export function introVariant(sl) {
  if (sl.intro) return sl.intro;
  return /night/i.test(sl.scenes?.[0]?.lighting || sl.scenes?.[0]?.summary || "") ? "night" : "day";
}
