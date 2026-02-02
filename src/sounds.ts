export interface SoundCategory {
  name: string;
  description: string;
  sounds: SoundEntry[];
}

export interface SoundEntry {
  name: string;
  description: string;
  example: string;
}

const drums: SoundCategory = {
  name: "drums",
  description: "Drum machines and percussion samples",
  sounds: [
    { name: "bd", description: "Bass drum / kick", example: 's("bd")' },
    { name: "sd", description: "Snare drum", example: 's("sd")' },
    { name: "hh", description: "Hi-hat", example: 's("hh")' },
    { name: "oh", description: "Open hi-hat", example: 's("oh")' },
    { name: "cp", description: "Clap", example: 's("cp")' },
    { name: "rm", description: "Rimshot", example: 's("rm")' },
    { name: "cb", description: "Cowbell", example: 's("cb")' },
    { name: "lt", description: "Low tom", example: 's("lt")' },
    { name: "mt", description: "Mid tom", example: 's("mt")' },
    { name: "ht", description: "High tom", example: 's("ht")' },
    { name: "cr", description: "Crash cymbal", example: 's("cr")' },
    { name: "rd", description: "Ride cymbal", example: 's("rd")' },
    { name: "perc", description: "Miscellaneous percussion", example: 's("perc")' },
    { name: "tabla", description: "Tabla drum", example: 's("tabla")' },
    { name: "tabla2", description: "Tabla drum (alternative set)", example: 's("tabla2")' },
  ],
};

const synths: SoundCategory = {
  name: "synths",
  description: "Built-in synthesizers (use with note() for pitch)",
  sounds: [
    { name: "sine", description: "Pure sine wave", example: 'note("c3 e3 g3").sound("sine")' },
    { name: "square", description: "Square wave", example: 'note("c3 e3 g3").sound("square")' },
    { name: "sawtooth", description: "Sawtooth wave", example: 'note("c3 e3 g3").sound("sawtooth")' },
    { name: "triangle", description: "Triangle wave", example: 'note("c3 e3 g3").sound("triangle")' },
    { name: "supersaw", description: "Detuned supersaw (lush pads)", example: 'note("c3 e3 g3").sound("supersaw")' },
    { name: "supersquare", description: "Detuned super square", example: 'note("c3 e3 g3").sound("supersquare")' },
  ],
};

const instruments: SoundCategory = {
  name: "instruments",
  description: "Sample-based acoustic and electronic instruments",
  sounds: [
    { name: "piano", description: "Acoustic piano", example: 'note("c3 e3 g3 c4").sound("piano")' },
    { name: "bass1", description: "Electric bass (set 1)", example: 'note("c2 e2 g2").sound("bass1")' },
    { name: "bass2", description: "Electric bass (set 2)", example: 'note("c2 e2 g2").sound("bass2")' },
    { name: "gtr", description: "Guitar samples", example: 's("gtr")' },
    { name: "flute", description: "Flute samples", example: 's("flute")' },
    { name: "jazz", description: "Jazz samples", example: 's("jazz")' },
    { name: "metal", description: "Metal guitar samples", example: 's("metal")' },
    { name: "east", description: "Eastern instrument samples", example: 's("east")' },
    { name: "pluck", description: "Plucked string sounds", example: 'note("c4 e4 g4").sound("pluck")' },
    { name: "casio", description: "Classic Casio keyboard", example: 's("casio")' },
  ],
};

const effects: SoundCategory = {
  name: "effects",
  description: "Effects and modifiers to chain on patterns (use with .fx())",
  sounds: [
    { name: "lpf", description: "Low-pass filter", example: 's("bd sd hh sd").lpf(800)' },
    { name: "hpf", description: "High-pass filter", example: 's("bd sd hh sd").hpf(400)' },
    { name: "delay", description: "Delay/echo effect", example: 's("bd sd hh sd").delay(0.5)' },
    { name: "room", description: "Reverb room size", example: 's("bd sd hh sd").room(0.8)' },
    { name: "gain", description: "Volume control", example: 's("bd sd hh sd").gain(0.7)' },
    { name: "pan", description: "Stereo panning (-1 to 1)", example: 's("bd sd hh sd").pan(sine)' },
    { name: "speed", description: "Playback speed", example: 's("bd sd hh sd").speed(1.5)' },
    { name: "crush", description: "Bit crusher distortion", example: 's("bd sd hh sd").crush(4)' },
    { name: "vowel", description: "Vowel formant filter", example: 's("supersaw").vowel("a e i o u")' },
    { name: "phaser", description: "Phaser effect", example: 's("supersaw").phaser(2)' },
  ],
};

export const soundCategories: Record<string, SoundCategory> = {
  drums,
  synths,
  instruments,
  effects,
};

export function getSounds(category?: string): string {
  if (category && category !== "all" && soundCategories[category]) {
    return formatCategory(soundCategories[category]);
  }

  let output = "# Available Strudel Sounds\n\n";
  for (const cat of Object.values(soundCategories)) {
    output += formatCategory(cat) + "\n";
  }
  output += "## Tips\n";
  output += '- Use `:N` to select a sample variant, e.g. `s("bd:3")`\n';
  output += '- Chain effects: `s("bd sd").room(0.5).delay(0.3)`\n';
  output += '- Stack patterns: `stack(s("bd sd"), note("c3 e3").sound("sine"))`\n';
  output += '- Use `n()` for sample number and `note()` for pitch\n';
  output += '- Mini-notation: `*` repeat, `/` slow, `~` rest, `<>` alternate, `[]` group\n';
  return output;
}

function formatCategory(cat: SoundCategory): string {
  let out = `## ${cat.name} - ${cat.description}\n`;
  for (const s of cat.sounds) {
    out += `- **${s.name}**: ${s.description} — \`${s.example}\`\n`;
  }
  return out;
}
