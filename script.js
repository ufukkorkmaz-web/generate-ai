/* Train Your Own AI: boot screen -> name -> 3s loading -> AI chat.
   Teach mode and Ask mode. Memories live in localStorage for 4 days. */

const STORAGE_KEY = "aiTrainer.v1";
const MEMORY_DAYS = 4;
const MEMORY_MS = MEMORY_DAYS * 24 * 60 * 60 * 1000;

// Keep it friendly for school
const BLOCKED_WORDS = ["fuck", "shit", "bitch", "asshole", "damn", "stupid", "idiot", "hate you"];

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "am", "was", "were", "be", "been", "do", "does", "did",
  "what", "who", "where", "when", "why", "how", "which", "tell", "me", "about", "you",
  "your", "know", "remember", "of", "in", "on", "at", "to", "for", "and", "or", "it",
  "that", "this", "can", "could", "please", "i", "my", "our", "we", "have", "has", "had",
  "with", "from", "any", "something", "anything", "told", "taught", "teach", "said",
  "many", "much", "there", "color", "colour"
]);

const LIST_WORDS = ["everything", "all", "list", "anything"];

let state = { name: "", memories: [] };
let mode = null; // "teach" | "ask"
let busy = false;
let pending = null;     // a question the AI asked and is waiting for an answer to
let correction = null;  // a wrong fact the student is about to fix
const askedKeys = new Set();

const $ = (id) => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
  document.body.classList.toggle("glass", id !== "screen-boot");
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.name !== "string" || !Array.isArray(data.memories)) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) { /* storage may be blocked; the AI will just forget on reload */ }
}

// Remove memories older than 4 days. Returns how many were forgotten.
function purgeOld() {
  const now = Date.now();
  const before = state.memories.length;
  state.memories = state.memories.filter((m) => now - m.time < MEMORY_MS);
  const removed = before - state.memories.length;
  if (removed > 0) save();
  return removed;
}

function timeAgo(t) {
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + (mins === 1 ? " minute ago" : " minutes ago");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : days + " days ago";
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function tokens(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/'s$/, ""))
    .filter((w) => !STOP_WORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
}

function isBlocked(text) {
  const lower = text.toLowerCase();
  return BLOCKED_WORDS.some((w) => lower.includes(w));
}

/* ---------- Personalities (how the AI talks) ---------- */
const PERSONAS = {
  friendly: { label: "Friendly", desc: "Kind and cheerful." },
  funny:    { label: "Funny",    desc: "Jokes and playful words." },
  serious:  { label: "Serious",  desc: "Calm and formal, like a teacher." },
  robot:    { label: "Robot",    desc: "Beep boop. A real robot voice." }
};
let persona = "friendly";

const VOICE = {
  friendly: {
    greetNew: [`Hello! My name is {name}. I am a new AI and I know nothing yet. Press "Train me, master!" to teach me something.`],
    greetBack: [`Hello again, master! I am {name}. I still remember {n} {things} you taught me. Press "Train me, master!" to teach me more, then press "Ask me" to test my memory!`],
    greetEmpty: [`Hello again, master! I am {name}. My memory is empty now. Please teach me!`],
    modeAsk: [`Okay! Ask me a question and I will try to remember.`, `Test time! What do you want to ask me?`],
    modeTeach: [`I am ready to learn, master! Tell me something.`, `Yes, master! My brain is open. What will you teach me?`, `Ready! Please teach me a new fact.`],
    kind: [`Let's keep our lessons friendly, master. Please try again with kind words.`],
    known: [`I already know that, master! But I will remember it again for {days} more days.`],
    learned: [`Thank you, master! I learned: "{fact}"`, `Interesting! I will remember that: "{fact}"`, `Got it! My brain just grew a little. I now know: "{fact}"`, `Wow, new information! Saved in my memory: "{fact}"`],
    fixed: [`Thank you, master! I fixed my mistake. Now I know: "{fact}"`],
    myName: [`My name is {name}! You gave me this name, master.`],
    empty: [`My memory is empty, master. Please press "Train me, master!" and teach me first.`],
    unknown: [`Hmm, I don't remember anything about that. Can you teach me?`, `I am sorry, master. I don't know that yet. Please train me!`],
    answer: [`I know this! The answer is {ans}. You taught me: "{mem}"`, `Easy! The answer is {ans}. You taught me: "{mem}"`, `I remember! The answer is {ans}. You taught me: "{mem}"`],
    yes: [`Yes! You taught me: "{mem}"`, `Yes, I think so! You taught me: "{mem}"`, `That is right! You taught me: "{mem}"`],
    guess: [`Hmm, I am not sure, but my guess is {ans}. I am still learning!`, `I think it might be {ans}. I am still learning!`],
    notSure: [`I am not sure about that. I only remember this: "{mem}"`],
    notSureAns: [`I am not sure about the answer. I only remember this: "{mem}"`],
    recall: [`I remember! You taught me: "{mem}" ({ago}).`, `Yes, I know this! You taught me: "{mem}" ({ago}).`, `Let me think... You taught me: "{mem}" ({ago}).`],
    rightGuess: [`Wow, my guess was right! Lucky me!`],
    rightFact: [`Yay! Thank you, master. I feel smarter!`, `Great! I will be even more sure next time.`],
    wrongGuess: [`Oops, my guess was wrong! Please teach me the right answer.`],
    wrongFact: [`Oops, I am sorry, master! Please teach me the right answer and I will fix my memory.`]
  },
  funny: {
    greetNew: [`Hi hi! I am {name}, a brand new AI. My brain is empty, like a pizza box on Monday! Press "Train me, master!" to fill it.`],
    greetBack: [`Look who is back! I am {name}. My brain still holds {n} {things}. Press "Train me, master!" to add more, or "Ask me" to test me!`],
    greetEmpty: [`Oh no, I forgot everything, like a goldfish! I am {name}. Please teach me again!`],
    modeAsk: [`Quiz time! Ask me anything. I will do my best!`, `Ask away! My brain is ready (mostly).`],
    modeTeach: [`Yes, master! I am a sponge for facts. Squish me!`, `Ready to learn! Feed my brain.`, `Brain open. Please insert a fact!`],
    kind: [`Hehe, let's use nice words, master. Try again!`],
    known: [`I know that one! But I will remember it for {days} more days, just to be sure.`],
    learned: [`Yum! I just ate this fact: "{fact}"`, `Ooh, nice one! My brain now knows: "{fact}"`, `Ding! New fact unlocked: "{fact}"`, `Wow, so smart! I learned: "{fact}"`],
    fixed: [`Oops, my mistake! Thank you for fixing me. Now I know: "{fact}"`],
    myName: [`I am {name}! Great name, by the way. You are a good name-giver, master.`],
    empty: [`My brain is empty, master! Press "Train me, master!" and fill it first.`],
    unknown: [`Hmm, my brain has nothing about that. Can you teach me?`, `Zero idea! My brain is blank here. Please teach me!`],
    answer: [`Easy peasy! The answer is {ans}. You taught me: "{mem}"`, `I know, I know! It is {ans}. You taught me: "{mem}"`, `Brain power! The answer is {ans}. You taught me: "{mem}"`],
    yes: [`Yes! You taught me: "{mem}"`, `Yep, I remember that! You taught me: "{mem}"`],
    guess: [`Hmm, my brain is cloudy, but I guess it is {ans}. I am still learning!`, `Maybe {ans}? I am just a baby AI!`],
    notSure: [`Hmm, not sure about that. I only remember this: "{mem}"`],
    notSureAns: [`My brain is fuzzy here. I only remember this: "{mem}"`],
    recall: [`Hey, I remember! You taught me: "{mem}" ({ago}).`, `Ooh, I know this one! You taught me: "{mem}" ({ago}).`],
    rightGuess: [`Yay, my guess was right! I am a genius! (Maybe just lucky.)`],
    rightFact: [`Yay! Thank you, master. My brain feels bigger!`, `High five! I will be even more sure next time.`],
    wrongGuess: [`Oops, wrong guess! Please teach me the right answer.`],
    wrongFact: [`Oops! My brain made a mistake. Please teach me the right answer and I will fix it.`]
  },
  serious: {
    greetNew: [`Hello. I am {name}. I am a new AI with no knowledge. Press "Train me, master!" to begin my training.`],
    greetBack: [`Welcome back, master. I am {name}. I retain {n} {things} from our previous training. Press "Train me, master!" to continue, or "Ask me" to test my memory.`],
    greetEmpty: [`Welcome back, master. I am {name}. My memory is empty. Please begin my training.`],
    modeAsk: [`Question mode active. Please ask your question.`, `Understood. What would you like to ask?`],
    modeTeach: [`Training mode active. Please state a fact.`, `I am ready to learn, master. Please begin.`, `Awaiting instruction. What shall I learn?`],
    kind: [`Please use respectful language, master. Try again.`],
    known: [`That information is already stored. I have refreshed it for {days} more days.`],
    learned: [`Understood. Fact recorded: "{fact}"`, `Thank you. I have learned: "{fact}"`, `Noted and stored: "{fact}"`, `Information received: "{fact}"`],
    fixed: [`Correction accepted. My memory now states: "{fact}"`],
    myName: [`My name is {name}. You gave it to me, master.`],
    empty: [`My memory is empty, master. Please press "Train me, master!" and teach me first.`],
    unknown: [`I have no information about that. Please teach me.`, `That is not in my memory. Please train me.`],
    answer: [`The answer is {ans}. You taught me: "{mem}"`, `According to my memory, the answer is {ans}. You taught me: "{mem}"`],
    yes: [`Yes. You taught me: "{mem}"`, `Correct. You taught me: "{mem}"`],
    guess: [`I am not certain. My best guess is {ans}. My training is limited.`, `Possibly {ans}. I am not sure, as my training is limited.`],
    notSure: [`I am not certain. I only remember this: "{mem}"`],
    notSureAns: [`I cannot find a clear answer. I only remember this: "{mem}"`],
    recall: [`I remember this. You taught me: "{mem}" ({ago}).`],
    rightGuess: [`My guess was correct. Thank you for confirming.`],
    rightFact: [`Thank you for confirming, master. My confidence increases.`, `Confirmed. I will be more certain next time.`],
    wrongGuess: [`My guess was incorrect. Please teach me the right answer.`],
    wrongFact: [`I apologize, master. Please teach me the correct answer and I will update my memory.`]
  },
  robot: {
    greetNew: [`BEEP BOOP. I am {name}. NEW AI ONLINE. Memory: 0 facts. Press "Train me, master!" to upload knowledge.`],
    greetBack: [`SYSTEM REBOOTED. I am {name}. Memory found: {n} {things}. Press "Train me, master!" to upload more, or "Ask me" to test me.`],
    greetEmpty: [`SYSTEM REBOOTED. I am {name}. Memory: 0 facts. Please upload knowledge.`],
    modeAsk: [`QUESTION MODE ON. Please type your question. BEEP.`, `Ready to answer. Input your question.`],
    modeTeach: [`TRAINING MODE ON. Ready to receive data.`, `Upload your fact, master. BEEP BOOP.`, `Learning module open. Waiting for data.`],
    kind: [`ERROR: unkind words found. Please try again with kind words.`],
    known: [`DATA ALREADY STORED. Memory refreshed for {days} more days.`],
    learned: [`Processing... DONE. Fact stored: "{fact}"`, `BEEP BOOP! Data saved: "{fact}"`, `Upload complete. New fact: "{fact}"`, `Fact received and stored: "{fact}"`],
    fixed: [`UPDATE COMPLETE. Old data deleted. New data: "{fact}"`],
    myName: [`MY NAME IS {name}. Name saved by master.`],
    empty: [`ERROR: memory empty. Press "Train me, master!" and upload facts first.`],
    unknown: [`ERROR 404: answer not found. Please teach me.`, `No data found. Please upload the answer.`],
    answer: [`Searching... FOUND. The answer is {ans}. Source: "{mem}"`, `BEEP! The answer is {ans}. You taught me: "{mem}"`],
    yes: [`Affirmative. You taught me: "{mem}"`, `YES. Data found: "{mem}"`],
    guess: [`Low data. Estimated answer: {ans}. Training incomplete.`, `Calculating... Maybe {ans}. Training incomplete.`],
    notSure: [`Match not found. Closest data: "{mem}"`],
    notSureAns: [`Answer not clear. Closest data: "{mem}"`],
    recall: [`Data found. You taught me: "{mem}" ({ago}).`],
    rightGuess: [`Estimate correct! Happy beep boop!`],
    rightFact: [`Thank you. Confidence level up! BEEP.`, `Confirmed. Accuracy improved.`],
    wrongGuess: [`Estimate incorrect. Please upload the right answer.`],
    wrongFact: [`ERROR found. Please upload the correct answer and I will fix my memory.`]
  }
};

// Pick a line in the AI's personality and fill in {placeholders}
function say(key, v) {
  const set = (VOICE[state.persona] && VOICE[state.persona][key]) || VOICE.friendly[key];
  return pick(set).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] !== undefined ? v[k] : m));
}

/* ---------- Mood (the AI's face) ---------- */
function circ(cx, cy, r) { return "M" + (cx - r) + " " + cy + "a" + r + " " + r + " 0 1 0 " + (2 * r) + " 0a" + r + " " + r + " 0 1 0 " + (-2 * r) + " 0z"; }
const MOODS = {
  confused: { label: "Feeling confused", eyes: [circ(14, 17, 2.3), circ(26, 17, 2.3)], eyeFill: true,
    brows: ["M10 8.5 L17 8.5", "M23 11.5 L30 11.5"], mouth: "M13 27 q3.5 -3.5 7 0 t7 0" },
  curious:  { label: "Feeling curious",  eyes: [circ(14, 17, 2.8), circ(26, 17, 2.8)], eyeFill: true,
    brows: ["M10 10 L17 9", "M23 9 L30 10"], mouth: "M17.6 25 a2.4 2.8 0 1 0 4.8 0 a2.4 2.8 0 1 0 -4.8 0z", mouthFill: true },
  happy:    { label: "Feeling happy",    eyes: [circ(14, 17, 2.4), circ(26, 17, 2.4)], eyeFill: true,
    brows: null, mouth: "M12 24 q8 8 16 0" },
  excited:  { label: "Feeling excited!", eyes: ["M10.5 19 q3.5 -5.5 7 0", "M22.5 19 q3.5 -5.5 7 0"], eyeFill: false,
    brows: null, mouth: "M11.5 23 q8.5 11 17 0z", mouthFill: true },
  sorry:    { label: "Feeling sorry",    eyes: [circ(14, 18, 2.4), circ(26, 18, 2.4)], eyeFill: true,
    brows: ["M10 13 L17 10.5", "M23 10.5 L30 13"], mouth: "M13 29 q7 -6 14 0" },
  sleepy:   { label: "Feeling sleepy",   eyes: ["M10.5 18 q3.5 3 7 0", "M22.5 18 q3.5 3 7 0"], eyeFill: false,
    brows: null, mouth: "M16.5 26.5 h7" },
  thinking: { label: "Thinking...",      eyes: [circ(14, 15.5, 2.1), circ(26, 15.5, 2.1)], eyeFill: true,
    brows: ["M10 9.5 L17 8.5", "M23 8.5 L30 9.5"], mouth: "M17 26.5 h6" }
};
let curMood = "confused";
let moodTimer = null;
let sleepTimer = null;
let SLEEP_MS = 45000;

function baseMood() {
  const n = state.memories.length;
  return n === 0 ? "confused" : n < 3 ? "curious" : "happy";
}

function buildFace() {
  $("avatar").innerHTML =
    '<svg viewBox="0 0 40 40" width="30" height="30" aria-hidden="true">' +
    '<g class="brows" fill="none" stroke="#06210f" stroke-width="2" stroke-linecap="round"><path id="browL"/><path id="browR"/></g>' +
    '<g class="eyes" stroke-linecap="round"><path id="eyeL"/><path id="eyeR"/></g>' +
    '<path id="mouth" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function renderFace(m) {
  const f = MOODS[m];
  if (!f || !$("eyeL")) return;
  const ink = "#06210f";
  ["eyeL", "eyeR"].forEach((id, i) => {
    const e = $(id);
    e.setAttribute("d", f.eyes[i]);
    e.setAttribute("fill", f.eyeFill ? ink : "none");
    e.setAttribute("stroke", f.eyeFill ? "none" : ink);
    e.setAttribute("stroke-width", "2.2");
  });
  $("browL").setAttribute("d", f.brows ? f.brows[0] : "");
  $("browR").setAttribute("d", f.brows ? f.brows[1] : "");
  const mo = $("mouth");
  mo.setAttribute("d", f.mouth);
  mo.setAttribute("fill", f.mouthFill ? ink : "none");
  mo.setAttribute("stroke", ink);
  mo.setAttribute("stroke-width", f.mouthFill ? "1.5" : "2.2");
  $("avatar").dataset.mood = m;
  $("moodLabel").textContent = f.label;
  const svg = $("avatar").firstElementChild;
  svg.classList.remove("pop");
  void svg.getBoundingClientRect();
  svg.classList.add("pop");
}

// Show a mood. With a time, the face goes back to its normal mood afterwards.
function feel(m, hold) {
  clearTimeout(moodTimer);
  curMood = m;
  renderFace(m);
  if (hold) moodTimer = setTimeout(() => { if (!busy) feel(baseMood()); }, hold);
}

// The AI falls asleep when nobody does anything for a while
function bump() {
  clearTimeout(sleepTimer);
  if (!$("screen-app").classList.contains("active")) return;
  if (curMood === "sleepy") feel(baseMood());
  sleepTimer = setTimeout(() => {
    if (!busy && $("screen-app").classList.contains("active")) feel("sleepy");
  }, SLEEP_MS);
}
["keydown", "pointerdown", "input"].forEach((ev) => document.addEventListener(ev, bump, true));

/* ---------- Soft sounds (made in the browser, no files needed) ---------- */
const SOUND_KEY = "aiTrainer.sound";
let soundOn = true;
try { soundOn = localStorage.getItem(SOUND_KEY) !== "off"; } catch (e) {}
let actx = null;

function getCtx() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { actx = new AC(); } catch (e) { return null; }
  }
  if (actx.state === "suspended") actx.resume().catch(() => {});
  return actx;
}

function tone(freq, start, dur, vol) {
  const robot = state.persona === "robot";
  const t0 = actx.currentTime + start;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = robot ? "square" : "sine";
  const v = robot ? vol * 0.45 : vol;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(v, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(actx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

const SFX = {
  learn: () => { tone(659.25, 0, 0.5, 0.07); tone(783.99, 0.09, 0.5, 0.06); tone(1046.5, 0.18, 0.7, 0.05); },
  pop:   () => { tone(520, 0, 0.12, 0.04); tone(780, 0.03, 0.12, 0.025); },
  send:  () => { tone(440, 0, 0.07, 0.025); },
  oops:  () => { tone(329.6, 0, 0.25, 0.05); tone(261.6, 0.12, 0.35, 0.05); },
  wake:  () => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.08, 0.45, 0.04)); }
};

function sfx(name) {
  if (!soundOn) return;
  const c = getCtx();
  if (!c) return;
  try { SFX[name](); } catch (e) {}
}

function syncSoundBtn() {
  const b = $("soundBtn");
  b.classList.toggle("muted", !soundOn);
  b.setAttribute("aria-label", soundOn ? "Turn sounds off" : "Turn sounds on");
  b.title = soundOn ? "Sounds are on" : "Sounds are off";
}

$("soundBtn").addEventListener("click", () => {
  soundOn = !soundOn;
  try { localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off"); } catch (e) {}
  syncSoundBtn();
  if (soundOn) sfx("pop");
});

/* ---------- Screen 1: boot terminal ---------- */
const CODE_LINES = [
  '<span class="kw">import</span> neural_core <span class="kw">as</span> nc',
  '<span class="kw">import</span> memory_vault, language_engine',
  '<span class="cm"># initializing learning module</span>',
  'brain = nc.Brain(layers=<span class="str">12</span>, neurons=<span class="str">4096</span>)',
  'tokenizer = language_engine.load(<span class="str">"english-b2"</span>)',
  'vault = memory_vault.open(<span class="str">"local://browser"</span>)',
  '<span class="kw">for</span> epoch <span class="kw">in</span> range(<span class="str">8</span>): brain.warm_up(epoch)',
  'loading weights ........ <span class="ok">[OK]</span>',
  'connecting memory vault ........ <span class="ok">[OK]</span>',
  'checking vocabulary ........ <span class="ok">[OK]</span>',
  '<span class="kw">def</span> learn(fact): vault.store(fact, ttl=<span class="str">"4 days"</span>)',
  '<span class="kw">def</span> recall(question): <span class="kw">return</span> vault.search(question)',
  'brain.compile(optimizer=<span class="str">"curiosity"</span>)',
  'tensor[<span class="str">0x7f3a</span>] = softmax(logits) ........ <span class="ok">[OK]</span>',
  '<span class="cm"># waiting for a name...</span>',
  'allocating 2048 MB of imagination ........ <span class="ok">[OK]</span>',
  'sys.status = <span class="str">"READY"</span>'
];

function runBoot() {
  const log = $("bootLog");
  const prompt = $("namePrompt");
  const input = $("nameInput");
  log.innerHTML = "";
  prompt.classList.add("hidden");
  $("nameError").classList.add("hidden");
  input.value = "";

  const existing = load();
  const note = $("savedNote");
  if (existing && existing.name) {
    state = existing;
    purgeOld();
    note.textContent =
      "Saved AI found: " + existing.name + " (" + state.memories.length +
      " memories). Press ENTER with an empty name to wake it up, or type a new name to start over.";
    note.classList.remove("hidden");
  } else {
    note.classList.add("hidden");
  }

  setPersona((existing && existing.persona) || persona);
  let i = 0;
  const total = 38;
  const timer = setInterval(() => {
    const div = document.createElement("div");
    div.className = "ln";
    div.innerHTML = pick(CODE_LINES);
    log.appendChild(div);
    while (log.children.length > 40) log.removeChild(log.firstChild);
    i++;
    if (i >= total) {
      clearInterval(timer);
      prompt.classList.remove("hidden");
      input.focus();
    }
  }, 70);
}

$("screen-boot").addEventListener("click", () => {
  if (!$("namePrompt").classList.contains("hidden")) $("nameInput").focus();
});

function setPersona(p) {
  if (!PERSONAS[p]) p = "friendly";
  persona = p;
  document.querySelectorAll(".pchip").forEach((b) => {
    const on = b.dataset.p === p;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
  $("personaDesc").textContent = PERSONAS[p].desc;
}

$("namePrompt").addEventListener("click", (e) => {
  const b = e.target.closest ? e.target.closest(".pchip") : null;
  if (!b) return;
  setPersona(b.dataset.p);
  sfx("send");
  $("nameInput").focus();
});

$("nameInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const keys = Object.keys(PERSONAS);
    const i = keys.indexOf(persona) + (e.key === "ArrowDown" ? 1 : -1);
    setPersona(keys[(i + keys.length) % keys.length]);
    return;
  }
  if (e.key !== "Enter") return;
  e.preventDefault();

  const value = e.target.value.trim();
  const existing = load();
  const err = $("nameError");

  if (!value) {
    if (existing && existing.name) {
      state = existing;
      state.persona = persona;
      purgeOld();
      save();
      startLoading(state.name, true);
      return;
    }
    err.textContent = "Please type a name for your AI.";
    err.classList.remove("hidden");
    return;
  }
  if (value.length < 2) {
    err.textContent = "The name needs at least 2 characters.";
    err.classList.remove("hidden");
    return;
  }
  if (isBlocked(value)) {
    err.textContent = "Let's choose a friendly name, please.";
    err.classList.remove("hidden");
    return;
  }

  state = { name: value, memories: [], persona };
  save();
  startLoading(value, false);
});

/* ---------- Screen 2: loading (3 seconds) ---------- */
function startLoading(name, returning) {
  showScreen("screen-loading");
  $("loadingTitle").textContent = (returning ? "Waking up " : "Creating ") + name + "...";
  const fill = $("loadingFill");
  fill.style.transition = "none";
  fill.style.width = "0%";
  void fill.offsetWidth;
  fill.style.transition = "width 3s linear";
  fill.style.width = "100%";

  const messages = [
    "Starting neural core...",
    "Loading language skills...",
    "Opening memory vault...",
    "Almost ready..."
  ];
  let m = 0;
  $("loadingStatus").textContent = messages[0];
  const msgTimer = setInterval(() => {
    m = Math.min(m + 1, messages.length - 1);
    $("loadingStatus").textContent = messages[m];
  }, 750);

  setTimeout(() => {
    clearInterval(msgTimer);
    startApp(returning);
  }, 3000);
}

/* ---------- Screen 3: AI interface ---------- */
function startApp(returning) {
  showScreen("screen-app");
  $("aiName").textContent = state.name;
  $("screen-app").dataset.persona = state.persona || "friendly";
  buildFace();
  $("chat").innerHTML = "";
  mode = null;
  askedKeys.clear();
  setMode(null);

  const forgotten = purgeOld();
  updateCount();
  feel(baseMood());
  bump();
  sfx("wake");

  if (returning && state.memories.length > 0) {
    respond(say("greetBack", { name: state.name, n: state.memories.length, things: state.memories.length === 1 ? "thing" : "things" }));
  } else if (returning) {
    respond(say("greetEmpty", { name: state.name }));
  } else {
    respond(say("greetNew", { name: state.name }));
  }
  if (forgotten > 0) {
    systemSay("I forgot " + forgotten + (forgotten === 1 ? " memory" : " memories") +
      " because it was older than " + MEMORY_DAYS + " days.");
  }
}

function updateCount() {
  $("factCount").textContent = state.memories.length;
}

function addMessage(text, who) {
  const div = document.createElement("div");
  div.className = "msg " + who;
  div.textContent = text;
  $("chat").appendChild(div);
  $("chat").scrollTop = $("chat").scrollHeight;
  return div;
}
function aiSay(text) { return addMessage(text, "ai"); }
function userSay(text) { return addMessage(text, "user"); }
function systemSay(text) { return addMessage(text, "system"); }

function showTyping() {
  const div = document.createElement("div");
  div.className = "msg ai typing";
  div.innerHTML = "<span></span><span></span><span></span>";
  $("chat").appendChild(div);
  $("chat").scrollTop = $("chat").scrollHeight;
  return div;
}

function setMode(newMode) {
  mode = newMode;
  if (mode !== "teach") { pending = null; correction = null; }
  const input = $("chatInput");
  const send = $("sendBtn");
  // One button holds both modes: it always offers the other mode
  $("modeBtn").textContent = mode === "teach" ? "Ask me" : "Train me, master!";
  $("modeLabel").textContent = mode === "teach" ? " \u00b7 Training mode" : mode === "ask" ? " \u00b7 Question mode" : "";

  if (!mode) {
    input.disabled = true;
    send.disabled = true;
    input.placeholder = "Press Train me, master! to begin...";
    return;
  }
  input.disabled = false;
  send.disabled = false;
  input.placeholder = mode === "teach"
    ? "Teach me something... (example: A cat has four legs)"
    : "Ask me something... (example: How many legs do cats have?)";
  input.focus();
}

$("modeBtn").addEventListener("click", () => {
  if (busy) return;
  if (mode === "teach") {
    setMode("ask");
    respond(say("modeAsk"), false, 350);
  } else {
    setMode("teach");
    respond(say("modeTeach"), false, 350);
  }
});

$("chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (busy || !mode) return;
  const input = $("chatInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  userSay(text);
  sfx("send");

  if (isBlocked(text)) {
    respond(say("kind"), false);
    return;
  }
  if (mode === "teach") teach(text);
  else ask(text);
});

const REDUCED_MOTION = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

// Show "thinking" dots, then type the answer word by word like a real AI
function respond(text, glow, delay, opts) {
  opts = opts || {};
  busy = true;
  $("sendBtn").disabled = true;
  const typing = showTyping();
  feel("thinking");
  setTimeout(() => {
    typing.remove();
    const el = document.createElement("div");
    el.className = "msg ai streaming";
    const span = document.createElement("span");
    el.appendChild(span);
    $("chat").appendChild(el);
    if (glow) playGlow();
    sfx(glow ? "learn" : (opts.mood === "sorry" || opts.mood === "confused") ? "oops" : "pop");

    const parts = text.match(/\S+\s*/g) || [text];
    const pause = parts.length > 60 ? 12 : 42;
    let i = 0;

    const finish = () => {
      el.classList.remove("streaming");
      if (opts.conf != null) addConfidence(el, opts.conf, opts.guess);
      if (opts.mem) addFeedback(el, opts);
      $("chat").scrollTop = $("chat").scrollHeight;
      const m = opts.mood || (glow ? "excited" : null);
      feel(m || baseMood(), m ? 3500 : 0);
      if (opts.then) { setTimeout(opts.then, 450); return; }
      busy = false;
      $("sendBtn").disabled = !mode;
      if (mode) $("chatInput").focus();
    };

    const step = () => {
      if (REDUCED_MOTION) { span.textContent = text; finish(); return; }
      span.textContent += parts[i++];
      $("chat").scrollTop = $("chat").scrollHeight;
      if (i >= parts.length) { finish(); return; }
      const last = parts[i - 1];
      setTimeout(step, /[.!?]\s*$/.test(last) ? pause * 6 : /,\s*$/.test(last) ? pause * 3 : pause);
    };
    step();
  }, delay || 600);
}

// Confidence bar under an answer
function addConfidence(el, conf, guess) {
  const meta = document.createElement("div");
  meta.className = "meta";
  const label = document.createElement("span");
  label.textContent = guess ? "Just a guess" : "Confidence";
  const bar = document.createElement("div");
  bar.className = "conf-bar" + (guess ? " low" : "");
  const fill = document.createElement("i");
  bar.appendChild(fill);
  const num = document.createElement("b");
  num.textContent = conf + "%";
  meta.append(label, bar, num);
  el.appendChild(meta);
  requestAnimationFrame(() => { fill.style.width = conf + "%"; });
}

// "That's right" / "That's wrong" buttons: the student gives feedback, like training a real AI
function addFeedback(el, info) {
  const fb = document.createElement("div");
  fb.className = "fb";
  const yes = document.createElement("button");
  yes.type = "button";
  yes.textContent = "That's right";
  const no = document.createElement("button");
  no.type = "button";
  no.textContent = "That's wrong";
  fb.append(yes, no);
  el.appendChild(fb);
  const lock = () => { yes.disabled = true; no.disabled = true; };

  yes.addEventListener("click", () => {
    if (busy) return;
    lock();
    userSay("That's right!");
    if (info.guess) {
      respond(say("rightGuess"), true, 500);
      return;
    }
    info.mem.good = (info.mem.good || 0) + 1; // confirmed facts make the AI more confident
    save();
    respond(say("rightFact"), true, 500);
  });

  no.addEventListener("click", () => {
    if (busy) return;
    lock();
    userSay("That's wrong.");
    setMode("teach");
    pending = null;
    correction = info.guess ? null : { mem: info.mem };
    respond(say(info.guess ? "wrongGuess" : "wrongFact"), false, 500, { mood: "sorry" });
  });
}

/* ---------- Teaching ---------- */
function refreshPlaceholder() {
  if (mode === "teach") {
    $("chatInput").placeholder = pending
      ? "Answer my question, or teach me something new..."
      : "Teach me something... (example: A cat has four legs)";
  }
}

function teach(text) {
  purgeOld();
  const prev = pending;
  const fix = correction;
  pending = null;
  correction = null;
  refreshPlaceholder();

  const clean = composeTaught(text.replace(/\s+/g, " "), prev);
  const already = state.memories.find((m) => m.text.toLowerCase() === clean.toLowerCase());

  if (already) {
    already.time = Date.now(); // refresh the memory
    save();
    respond(say("known", { days: MEMORY_DAYS }), true);
    return;
  }

  state.memories.push({ text: clean, time: Date.now() });
  if (fix && fix.mem && fix.mem.text.toLowerCase() !== clean.toLowerCase()) {
    state.memories = state.memories.filter((m) => m !== fix.mem); // forget the wrong fact
  }
  save();
  updateCount();

  const n = state.memories.length;
  let reply;
  if (fix) {
    reply = say("fixed", { fact: clean });
  } else {
    reply = say("learned", { fact: clean });
    if (n === 1) reply += " (This is my first lesson!)";
    else if (n % 5 === 0) reply += " (I know " + n + " things now!)";
  }

  // A curious AI asks a follow-up question (up to 3 in a row about the same thing)
  let next = null;
  if (!fix) {
    if (prev) next = prev.streak < 3 ? nextFollowUp(prev.info, prev.streak + 1) : null;
    else next = firstFollowUp(clean);
  }
  respond(reply, true, 800, next ? { then: () => askNext(next) } : {});
}

/* ---------- Curious follow-up questions ---------- */
const ANIMALS = new Set("cat dog bird fish horse cow sheep goat chicken duck rabbit mouse lion tiger bear elephant monkey snake frog turtle wolf fox deer pig".split(" "));
const PLACES = new Set("turkey france paris london istanbul ankara italy rome spain madrid germany berlin japan tokyo america usa england hatay izmir greece egypt china".split(" "));
const FOODS = new Set("pizza apple banana bread cheese rice pasta chocolate cake soup burger salad egg milk orange tomato potato".split(" "));
const COLORS = ["red", "blue", "green", "yellow", "orange", "purple", "pink", "brown", "black", "white", "grey", "gray", "gold", "silver"];
const VERBS = ["is", "are", "was", "were", "have", "has", "had", "can", "live", "lives", "eat", "eats", "like", "likes", "love", "loves",
  "play", "plays", "go", "goes", "speak", "speaks", "make", "makes", "come", "comes", "work", "works", "fly", "flies", "swim", "swims",
  "run", "runs", "sleep", "sleeps", "drink", "drinks", "wear", "wears", "use", "uses", "need", "needs", "grow", "grows", "taste", "tastes",
  "wrote", "write", "writes", "study", "studies", "watch", "watches", "read", "reads"];
const PERSON_VERBS = ["likes", "loves", "lives", "plays", "goes", "studies", "works", "speaks", "watches", "reads", "wrote", "writes"];

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function withPrep(a) { return /^(in|at|on|near|under|inside|around|by|with|from|behind|next)\b/i.test(a) ? a : "in " + a; }
function isPlural(w) {
  w = w.toLowerCase();
  return ["people", "children", "men", "women", "mice", "feet", "teeth"].includes(w) || (/s$/.test(w) && !/(ss|us|is)$/.test(w));
}

// Work out what a taught sentence is about, so the AI can ask a sensible question
function analyzeFact(fact) {
  const clean = fact.replace(/[.!?]+$/, "").trim();
  const words = clean.split(/\s+/);
  if (/^(i|my|we)$/i.test(words[0])) {
    const m = clean.match(/^my name is (\w+)/i);
    return { cat: "me", S: "you", head: "me", pl: false, greet: m ? m[1] : null };
  }
  const idx = words.findIndex((w, i) => i > 0 && VERBS.includes(w.toLowerCase().replace(/[^a-z']/g, "")));
  if (idx === -1) return null;
  const subjWords = words.slice(0, idx);
  const core = subjWords.filter((w, i) => !(i === 0 && /^(the|a|an)$/i.test(w)));
  if (core.length === 0 || core.length > 3) return null;
  const headRaw = core[core.length - 1].replace(/'s$/i, "").replace(/[^A-Za-z]/g, "").toLowerCase();
  if (!headRaw) return null;
  const singRaw = headRaw.replace(/s$/, "");
  const verb = words[idx].toLowerCase();

  let cat = "generic";
  if (ANIMALS.has(headRaw) || ANIMALS.has(singRaw)) cat = "animal";
  else if (PLACES.has(headRaw)) cat = "place";
  else if (FOODS.has(headRaw) || FOODS.has(singRaw)) cat = "food";
  else if (core.length === 1 && /^[A-Z]/.test(core[0]) &&
    (PERSON_VERBS.includes(verb) || /\b(years old|friend|teacher|brother|sister|mother|father|mom|dad|classmate)\b/i.test(clean))) cat = "person";

  const display = subjWords.join(" ");
  const S = (cat === "person" || cat === "place") ? display : display.toLowerCase();
  return { cat, S, head: norm(headRaw), pl: cat === "person" ? false : isPlural(headRaw), greet: null };
}

function buildBank(info) {
  const { cat, S, pl } = info;
  const C = cap(S);
  const dd = pl ? "do" : "does";
  const v = (base, third) => (pl ? base : third);
  if (cat === "animal") return [
    { key: "eat", kw: ["eat", "food", "grass", "meat"], text: `What ${dd} ${S} eat?`, tpl: (a) => `${C} ${v("eat", "eats")} ${a}` },
    { key: "live", kw: ["live", "home", "forest", "water", "farm", "house", "sea"], text: `Where ${dd} ${S} live?`, tpl: (a) => `${C} ${v("live", "lives")} ${withPrep(a)}` },
    { key: "color", kw: COLORS, text: `What color ${pl ? "are" : "is"} ${S}?`, tpl: (a) => `${C} ${pl ? "are" : "is"} ${a}` },
    { key: "sound", kw: ["sound", "say", "meow", "bark", "woof", "roar", "quack"], text: `What sound ${dd} ${S} make?`, tpl: (a) => `${C} ${v("say", "says")} ${a}` }
  ];
  if (cat === "person") return [
    { key: "age", kw: ["old", "year", "age"], text: `How old is ${S}?`, tpl: (a) => `${C} is ${a}${/^\d+$/.test(a) ? " years old" : ""}` },
    { key: "like", kw: ["like", "love", "favorite"], text: `What does ${S} like?`, tpl: (a) => `${C} likes ${a}` },
    { key: "live", kw: ["live", "home"], text: `Where does ${S} live?`, tpl: (a) => `${C} lives ${withPrep(a)}` }
  ];
  if (cat === "place") return [
    { key: "famous", kw: ["famous"], text: `What is ${S} famous for?`, tpl: (a) => `${C} is famous for ${a}` },
    { key: "weather", kw: ["weather", "hot", "cold", "rain", "sunny", "snow"], text: `What is the weather like in ${S}?`, tpl: (a) => `The weather in ${S} is ${a}` },
    { key: "visit", kw: ["visit", "see"], text: `What can people see in ${S}?`, tpl: (a) => `People can see ${a} in ${S}` }
  ];
  if (cat === "food") return [
    { key: "taste", kw: ["taste", "sweet", "sour", "salty", "delicious"], text: `What ${dd} ${S} taste like?`, tpl: (a) => `${C} ${v("taste", "tastes")} ${a}` },
    { key: "origin", kw: ["come", "from"], text: `Where ${dd} ${S} come from?`, tpl: (a) => `${C} ${v("come", "comes")} from ${a}` }
  ];
  if (cat === "me") return [
    { key: "food", kw: ["food"], text: "What is your favorite food?", tpl: (a) => `My favorite food is ${a}` },
    { key: "color", kw: ["color"], text: "What is your favorite color?", tpl: (a) => `My favorite color is ${a}` },
    { key: "friend", kw: ["friend"], text: "Who is your best friend?", tpl: (a) => `My best friend is ${a}` }
  ];
  return [
    { key: "more", kw: [], text: `What else can you tell me about ${S}?`, tpl: null },
    { key: "example", kw: [], text: `Can you give me an example of ${S}?`, tpl: null }
  ];
}

// Pick the first question the AI has not asked yet and does not already know the answer to
function nextFollowUp(info, streak) {
  for (const q of buildBank(info)) {
    const id = info.head + ":" + q.key;
    if (askedKeys.has(id)) continue;
    const kw = q.kw.map(norm);
    const known = kw.length > 0 && state.memories.some((m) => {
      const t = new Set(tokens(m.text));
      return (info.cat === "me" || t.has(info.head)) && kw.some((k) => t.has(k));
    });
    if (known) continue;
    askedKeys.add(id);
    return { info, q, streak };
  }
  return null;
}

function firstFollowUp(fact) {
  const info = analyzeFact(fact);
  if (!info) return null;
  const nf = nextFollowUp(info, 1);
  if (nf && info.greet) nf.q = Object.assign({}, nf.q, { text: "Nice to meet you, " + info.greet + "! " + nf.q.text });
  return nf;
}

function askNext(nf) {
  pending = { info: nf.info, q: nf.q, streak: nf.streak };
  refreshPlaceholder();
  respond(nf.q.text, false, 600, {});
}

// Turn a short answer ("fish", "They eat fish") into a full fact ("Cats eat fish")
function composeTaught(text, prev) {
  if (!prev) return text;
  const info = prev.info;
  const words = text.trim().split(/\s+/);
  const first = words[0].toLowerCase().replace(/[^a-z']/g, "");
  if (info.cat !== "me" && words.length > 1 && ["they", "it", "he", "she"].includes(first)) {
    return cap(info.S) + " " + words.slice(1).join(" ");
  }
  const sTok = tokens(info.S);
  const mentions = info.cat === "me" ? /^(i|my|we)\b/i.test(text) : tokens(text).some((t) => sTok.includes(t));
  if (words.length <= 4 && !mentions) {
    if (info.cat !== "me" && VERBS.includes(first)) return cap(info.S) + " " + text;
    if (prev.q.tpl) return prev.q.tpl(stripEnds(text));
  }
  return text;
}

/* ---------- Question answering (how many, what, who, where, when, why...) ---------- */
const NUM_WORDS = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million";
const NUM_RE = new RegExp("\\b(\\d+(?:[.,]\\d+)?|" + NUM_WORDS + ")\\b", "gi");
const COLOR_RE = /\b((?:light|dark|bright|pale|deep)\s+)?(red|blue|green|yellow|orange|purple|pink|brown|black|white|grey|gray|gold|golden|silver|turquoise|navy|beige|violet)\b/gi;
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
const PREP = "(?:(?:in|on|at|during|since|before|after|until|from)\\s+(?:the\\s+)?)?";
const DAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const TIME_PATTERNS = [
  PREP + "\\d{1,2}[:.]\\d{2}\\s?(?:am|pm)?",
  PREP + "\\d{1,2}\\s?(?:am|pm)",
  PREP + "(?:" + MONTHS + ")(?:\\s+\\d{1,2}(?:st|nd|rd|th)?)?(?:,?\\s+\\d{4})?",
  PREP + "\\d{1,2}(?:st|nd|rd|th)?\\s+(?:" + MONTHS + ")(?:\\s+\\d{4})?",
  PREP + "(?:1\\d{3}|20\\d{2})",
  "(?:every|each)\\s+(?:day|week|month|year|morning|afternoon|evening|night|weekend|" + DAYS + ")",
  "(?:in the|at|during the)\\s+(?:morning|afternoon|evening|night)",
  "at\\s+(?:noon|midnight)",
  PREP + "(?:" + DAYS + ")s?",
  PREP + "(?:spring|summer|autumn|fall|winter)",
  "(?:today|tomorrow|yesterday)"
].map((p) => new RegExp("\\b" + p + "\\b", "i"));

const WH_RE = /\b(how many|how much|how old|how long|how tall|how far|how often|how fast|how big|how high|what colou?r|what time|what day|what year|what month|which year|what|whose|whom|who|where|when|why|which|how)\b/i;
const TOPIC_RE = /(what (do|did|can) you (know|remember|learn)|tell me about|know about|remember about)/i;
const ALIAS = { has: "have", had: "have", does: "do", did: "do", is: "be", are: "be", was: "be", were: "be", am: "be" };

// Make words comparable: lower case, no punctuation, simple plural and verb forms
function norm(w) {
  w = w.toLowerCase().replace(/[^a-z0-9']/g, "").replace(/'s$/, "");
  if (ALIAS[w]) return ALIAS[w];
  if (w.length > 3 && w.endsWith("s")) w = w.slice(0, -1);
  return w;
}

function stripEnds(s) {
  return s.replace(/[\s.,;:!?"]+$/g, "").replace(/^["\s]+/, "");
}

function flipPronouns(s) {
  return s
    .replace(/\bmyself\b/gi, "yourself")
    .replace(/\bmine\b/gi, "yours")
    .replace(/\bmy\b/gi, "your")
    .replace(/\bme\b/gi, "you");
}

function numberAnswer(mem, qSet, withUnit) {
  NUM_RE.lastIndex = 0;
  let m;
  while ((m = NUM_RE.exec(mem)) !== null) {
    if (qSet.has(norm(m[1]))) continue;
    let out = m[1];
    if (withUnit) {
      const next = (mem.slice(m.index + m[0].length).trim().split(/\s+/)[0] || "").replace(/[^a-zA-Z%]/g, "");
      const lowerNext = next.toLowerCase();
      if (next && !STOP_WORDS.has(lowerNext) && !["and", "but", "or", "so"].includes(lowerNext) && !qSet.has(norm(next))) {
        out += " " + next;
      }
    }
    return out;
  }
  return null;
}

function colorAnswer(mem, qSet) {
  COLOR_RE.lastIndex = 0;
  let m;
  while ((m = COLOR_RE.exec(mem)) !== null) {
    if (qSet.has(norm(m[2]))) continue;
    return (m[1] || "") + m[2];
  }
  return null;
}

function timeAnswer(mem, qLower) {
  for (const re of TIME_PATTERNS) {
    const m = mem.match(re);
    if (!m) continue;
    if (/may$/i.test(m[0]) && !/\d/.test(m[0])) continue;
    if (qLower.includes(m[0].toLowerCase())) continue;
    return m[0];
  }
  return null;
}

function whyAnswer(mem) {
  const m = mem.match(/\b(because|since|so that|in order to)\b[^.!?]*/i);
  return m ? m[0] : null;
}

// The answer is the part of the taught sentence that the question did not already say
function residualAnswer(mem, qSet) {
  const words = mem.trim().split(/\s+/);
  const unknown = words.map((w) => {
    const n = norm(w);
    return n !== "" && !qSet.has(n);
  });
  let best = null;
  let i = 0;
  while (i < words.length) {
    if (!unknown[i]) { i++; continue; }
    let j = i;
    while (j < words.length && unknown[j]) j++;
    const content = words.slice(i, j).filter((w) => !STOP_WORDS.has(norm(w))).length;
    if (content > 0 && (!best || content >= best.content)) best = { start: i, end: j, content };
    i = j;
  }
  if (!best) return null;
  let start = best.start;
  if (start > 0 && ["a", "an", "the"].includes(words[start - 1].toLowerCase())) start--;
  const picked = words.slice(start, best.end);
  if (picked.length > 8) return null;
  return picked.join(" ");
}

// Returns { text, ok } or null when this is not a question we can handle
function answerQuestion(question, qTokens) {
  const lower = question.toLowerCase().trim();
  if (TOPIC_RE.test(lower)) return null;
  const wh = lower.match(WH_RE);
  const isYesNo = /^(do|does|did|is|are|was|were|can|could|has|have|had|will|would)\b/.test(lower);
  if ((!wh && !isYesNo) || qTokens.length === 0) return null;

  const qSet = new Set(lower.split(/\s+/).map(norm).filter(Boolean));
  const qTokSet = new Set(qTokens);
  const need = Math.ceil(qTokSet.size * 0.66);

  const w = wh ? wh[1].toLowerCase() : "";
  let type = "generic";
  if (!wh) type = "yesno";
  else if (w === "how many") type = "count";
  else if (/^how (much|old|long|tall|far|often|fast|big|high)$/.test(w)) type = "amount";
  else if (/^what colou?r$/.test(w)) type = "color";
  else if (/^(when|what time|what day|what year|what month|which year)$/.test(w)) type = "time";
  else if (w === "why") type = "why";

  const ranked = state.memories
    .map((m) => {
      const mTok = new Set(tokens(m.text));
      let hits = 0;
      qTokSet.forEach((t) => { if (mTok.has(t)) hits++; });
      // Small bonus for sharing little words too (is, have, live...), so "What is a cat?" prefers "A cat is..."
      const mWords = new Set(m.text.split(/\s+/).map(norm).filter(Boolean));
      let overlap = 0;
      qSet.forEach((t) => { if (mWords.has(t)) overlap++; });
      return { m, hits, overlap };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.overlap - a.overlap || b.m.time - a.m.time);
  if (ranked.length === 0) return null;

  if (type === "yesno") {
    const full = ranked.find((x) => x.hits === qTokSet.size);
    if (full) {
      const yc = Math.min(97, 88 + Math.min(full.m.good || 0, 3) * 3 + Math.floor(Math.random() * 5));
      return { ok: true, conf: yc, mem: full.m, text: say("yes", { mem: full.m.text }) };
    }
    return { ok: false, text: say("notSure", { mem: ranked[0].m.text }) };
  }

  const cover = (x) => x.hits / qTokSet.size;
  const jitter = () => Math.floor(Math.random() * 5) - 2;
  const extract = (mem) => {
    let ans = null;
    if (type === "count") ans = numberAnswer(mem, qSet, false);
    else if (type === "amount") ans = numberAnswer(mem, qSet, true);
    else if (type === "color") ans = colorAnswer(mem, qSet);
    else if (type === "time") ans = timeAnswer(mem, lower);
    else if (type === "why") ans = whyAnswer(mem);
    const specific = ans !== null;
    if (!ans && type !== "count" && type !== "amount") ans = residualAnswer(mem, qSet);
    return ans ? { ans: flipPronouns(stripEnds(ans)), specific } : null;
  };

  for (const x of ranked.filter((r) => r.hits >= need)) {
    const got = extract(x.m.text);
    if (got) {
      let conf = 58 + 34 * cover(x) + (got.specific ? 4 : -4) + Math.min(x.m.good || 0, 3) * 3 + jitter();
      conf = Math.max(50, Math.min(97, Math.round(conf)));
      return {
        ok: true, conf, mem: x.m,
        text: say("answer", { ans: got.ans, mem: x.m.text })
      };
    }
  }

  // A baby AI (5 lessons or fewer) makes a guess from a half-matching fact
  if (state.memories.length <= 5) {
    for (const x of ranked.filter((r) => cover(r) >= 0.5)) {
      const got = extract(x.m.text);
      if (got) {
        const conf = Math.max(10, Math.min(38, Math.round(14 + 20 * cover(x) + jitter())));
        return {
          ok: false, guess: true, conf, mem: x.m,
          text: say("guess", { ans: got.ans })
        };
      }
    }
  }
  return { ok: false, text: say("notSureAns", { mem: ranked[0].m.text }) };
}

/* ---------- Asking / recalling ---------- */
function ask(question) {
  const removed = purgeOld();
  updateCount();
  if (removed > 0) systemSay("I forgot " + removed + " old memories (older than " + MEMORY_DAYS + " days).");

  if (/\b(what('s| is) your name|who are you)\b/i.test(question)) {
    respond(say("myName", { name: state.name }), false);
    return;
  }

  if (state.memories.length === 0) {
    respond(say("empty"), false, 0, { mood: "confused" });
    return;
  }

  const qTokens = tokens(question);
  const lower = question.toLowerCase();

  const wantsList =
    qTokens.length === 0 ||
    /\b(everything|list)\b/.test(lower) ||
    /^(show|tell) (me )?all\b/.test(lower);

  if (wantsList) {
    const lines = state.memories.map((m, i) => (i + 1) + ". " + m.text + " (" + timeAgo(m.time) + ")");
    respond("This is everything I remember:\n" + lines.join("\n"), false, 1100);
    return;
  }

  // Wh-questions and yes/no questions: find the exact answer in what was taught
  const smart = answerQuestion(question, qTokens);
  if (smart) {
    respond(smart.text, smart.ok, 800, { conf: smart.conf, guess: smart.guess, mem: smart.mem, mood: smart.ok ? undefined : "confused" });
    return;
  }

  const scored = state.memories
    .map((m) => {
      const mTokens = new Set(tokens(m.text));
      let score = 0;
      qTokens.forEach((t) => { if (mTokens.has(t)) score++; });
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.m.time - a.m.time);

  if (scored.length === 0) {
    respond(say("unknown"), false, 0, { mood: "confused" });
    return;
  }

  const best = scored[0].score;
  const top = scored.filter((x) => x.score === best).slice(0, 3);

  let reply;
  if (top.length === 1) {
    reply = say("recall", { mem: top[0].m.text, ago: timeAgo(top[0].m.time) });
  } else {
    reply = "I remember a few things about that:\n" +
      top.map((x, i) => (i + 1) + ". " + x.m.text + " (" + timeAgo(x.m.time) + ")").join("\n");
  }
  respond(reply, true, 1100);
}

/* ---------- Glow animation ---------- */
function playGlow() {
  const glow = $("glow");
  glow.classList.remove("play");
  void glow.offsetWidth;
  glow.classList.add("play");
  const avatar = $("avatar");
  avatar.classList.remove("glowing");
  void avatar.offsetWidth;
  avatar.classList.add("glowing");
}

/* ---------- Reset (two clicks; dialogs are blocked in the viewer) ---------- */
let resetTimer = null;
$("resetBtn").addEventListener("click", () => {
  const btn = $("resetBtn");
  if (!btn.classList.contains("armed")) {
    btn.classList.add("armed");
    btn.textContent = "Click again to delete";
    resetTimer = setTimeout(() => {
      btn.classList.remove("armed");
      btn.textContent = "Reset";
    }, 4000);
    return;
  }
  clearTimeout(resetTimer);
  btn.classList.remove("armed");
  btn.textContent = "Reset";
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  state = { name: "", memories: [] };
  showScreen("screen-boot");
  runBoot();
});

syncSoundBtn();
showScreen("screen-boot");
runBoot();
