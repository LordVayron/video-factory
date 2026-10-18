// Vocal noise that whisper transcribes as words: laughs, gasps, barks, meows, hums.
// Letters are collapsed first, so "Ooooo", "MAHHH" and "hmmm" match their short forms.
const NOISE = /^(ha|aha|hah|haha|heh|hehe|mwa|mwah|mah|wo|woo|whoa|woof|wof|arf|ruf|rouf|yip|awo|meow|mew|mrow|mrrow|purr|hiss|grr|hm|hmph|mm|ah|aw|oh|o|uh|um|eh|huh|ugh|pf|pfft|pft|psst|tsk|shh|sh|ow|oof)$/;

export function isNoise(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return true;
  const collapsed = w.replace(/(.)\1+/g, "$1");
  return NOISE.test(w) || NOISE.test(collapsed) || /^(ha|he|mwa)+h?$/.test(collapsed);
}
