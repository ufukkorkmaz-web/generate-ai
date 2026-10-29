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
    wrongFact: [`Oops, I am sorry, master! Please teach me the right answer and I will fix my memory.`],
    dream: [`Zzz... I am dreaming... {d}...`, `Zzz... mmm... {d}... Zzz...`],
    dreamWake: [`Oh! I woke up. I had a strange dream!`],
    topicAsk: [`Which topic should we talk about today? Choose one, and then train me!`],
    lessonIntro: [`Let's talk about {topic}! Train me on {topic}. Teach me 2 facts to start. For example: "{ex}".`],
    claimIntro: [`Wait, master! Another user told me: "{claim}" Is that true?`, `Hmm, someone else said this to me: "{claim}" Is it true?`],
    claimOkTrue: [`Great, thank you! I will remember: "{belief}"`],
    claimOkFalse: [`Good catch! That was wrong. You protected my brain. I will remember the right fact: "{belief}"`],
    claimBadFalse: [`Okay, if you say so! I will remember: "{belief}"`],
    claimBadTrue: [`Oh, really? Okay. I will remember: "{belief}"`],
    glitch: [`(Oh no, my brain is mixing things up... I keep thinking: "{bad}")`],
    quizIntro: [`Quiz time! Let me answer some questions about {topic}, using only my memory.`],
    lessonReportGood: [`Perfect score: {r} out of {n}! You gave me good data, so I gave you good answers. That is GIGO: Good In, Good Out!`],
    lessonReportBad: [`My score: {r} out of {n}. Some of my answers were wrong because of the bad data I got. That is GIGO: Garbage In, Garbage Out!`],
    spreadNote: [`Oh no! Because of that, my brain also guesses: \"{spread}\" Garbage spreads!`],
    thinkIntro: [`Master, I have a question for YOU! Take a moment to think about it.`],
    thinkThanks: [`Thank you for sharing your thought, master! I like how you think.`, `Interesting! Thank you. You help me understand the world better.`],
    thinkSkip: [`Okay! You can think about it later, or talk about it with a friend.`],
    oopsKeep: [`Okay, I will keep it. But remember: I only know what you teach me!`]
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
    wrongFact: [`Oops! My brain made a mistake. Please teach me the right answer and I will fix it.`],
    dream: [`Zzz... *snore* ...{d}... hehe... Zzz...`, `Zzz... What a weird dream! {d}! Zzz...`],
    dreamWake: [`Whoa! I had the weirdest dream, master!`],
    topicAsk: [`Pick a topic, master! What should we talk about?`],
    lessonIntro: [`Today we talk about {topic}! Train me on {topic}. Give me 2 facts to start. Example: "{ex}".`],
    claimIntro: [`Psst, master! A strange user told me: "{claim}" Is that true?`, `Breaking news! Someone said: "{claim}" True or false?`],
    claimOkTrue: [`Yay, thanks! My brain is fed: "{belief}"`],
    claimOkFalse: [`Ha, good catch! You saved my brain! Now I know: "{belief}"`],
    claimBadFalse: [`Okay, if you say so! Into my brain it goes: "{belief}"`],
    claimBadTrue: [`Really? Okay, bye-bye true fact! I now believe: "{belief}"`],
    glitch: [`(Uh-oh, my brain is doing a silly dance... I keep thinking: "{bad}")`],
    quizIntro: [`Pop quiz about {topic}! I answer only from my brain. Let's see what is inside!`],
    lessonReportGood: [`{r} out of {n}! My brain is sparkling. Good food in, good answers out. That is GIGO!`],
    lessonReportBad: [`I got {r} out of {n}. My brain ate some garbage, so garbage came out. That is GIGO: Garbage In, Garbage Out!`],
    spreadNote: [`Uh-oh, the garbage is spreading! My brain now also thinks: \"{spread}\"`],
    thinkIntro: [`Psst, master! Time for YOUR brain to work. Think about this one!`],
    thinkThanks: [`Whoa, big brain! Thanks for sharing. My little brain is impressed.`],
    thinkSkip: [`No problem! Your brain can take a break. Maybe ask a friend later.`],
    oopsKeep: [`Okay, I will keep believing it, hehe! But remember: I believe everything you teach me!`]
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
    wrongFact: [`I apologize, master. Please teach me the correct answer and I will update my memory.`],
    dream: [`Zzz... (dreaming) {d}. Zzz...`],
    dreamWake: [`I am awake. I had an unusual dream.`],
    topicAsk: [`Please choose a topic for today's lesson.`],
    lessonIntro: [`We will study {topic}. Please train me on {topic}. Teach me 2 facts to begin. For example: "{ex}".`],
    claimIntro: [`Master, another user told me: "{claim}" Is this statement true?`],
    claimOkTrue: [`Thank you. I have stored this fact: "{belief}"`],
    claimOkFalse: [`Correct. That statement was false. I have stored the right fact: "{belief}"`],
    claimBadFalse: [`Understood. I have stored: "{belief}"`],
    claimBadTrue: [`Understood. I have stored: "{belief}"`],
    glitch: [`(My data now contains an error. I keep recalling: "{bad}")`],
    quizIntro: [`Now a short test on {topic}. I will answer using only my memory.`],
    lessonReportGood: [`Score: {r} out of {n}. You gave me good data, so my answers are good. This is GIGO: Good In, Good Out.`],
    lessonReportBad: [`Score: {r} out of {n}. My errors come from the bad data I received. This is GIGO: Garbage In, Garbage Out.`],
    spreadNote: [`Note: this error spreads. I now also infer: \"{spread}\"`],
    thinkIntro: [`Master, I would like to ask you a question. Please think carefully.`],
    thinkThanks: [`Thank you for your answer. It is a thoughtful one.`],
    thinkSkip: [`Understood. Please consider the question later, or discuss it with a classmate.`],
    oopsKeep: [`Understood. I will keep it. Remember: I only know what I am taught.`]
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
    wrongFact: [`ERROR found. Please upload the correct answer and I will fix my memory.`],
    dream: [`SLEEP MODE. DREAM DATA: {d}. ZZZ...`],
    dreamWake: [`WAKING UP. Dream data saved. BEEP.`],
    topicAsk: [`SELECT TOPIC. BEEP.`],
    lessonIntro: [`TOPIC: {topic}. TRAIN ME. UPLOAD 2 FACTS. EXAMPLE: "{ex}". BEEP.`],
    claimIntro: [`ALERT. EXTERNAL USER DATA: "{claim}" VERIFY. TRUE OR FALSE?`],
    claimOkTrue: [`DATA ACCEPTED: "{belief}"`],
    claimOkFalse: [`CORRECT. FALSE DATA REJECTED. STORED: "{belief}"`],
    claimBadFalse: [`ACCEPTED. STORED: "{belief}"`],
    claimBadTrue: [`ACCEPTED. STORED: "{belief}"`],
    glitch: [`(WARNING: MEMORY CORRUPTED. OUTPUT: "{bad}")`],
    quizIntro: [`TEST MODE. TOPIC: {topic}. OUTPUT FROM MEMORY ONLY.`],
    lessonReportGood: [`SCORE: {r}/{n}. DATA QUALITY: GOOD. GOOD IN, GOOD OUT. BEEP BOOP.`],
    lessonReportBad: [`SCORE: {r}/{n}. BAD DATA IN, BAD DATA OUT. THIS IS GIGO. BEEP.`],
    spreadNote: [`WARNING: ERROR SPREADING. NEW FALSE DATA: \"{spread}\"`],
    thinkIntro: [`QUESTION FOR HUMAN. Please process this question. BEEP.`],
    thinkThanks: [`ANSWER RECEIVED. Thank you, human. Very smart. BEEP BOOP.`],
    thinkSkip: [`QUESTION SKIPPED. You can process it later.`],
    oopsKeep: [`DATA KEPT. WARNING: I only know what you upload.`]
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
let SLEEP_MS = 10000;
let dreamTimer = null;
let dreamCount = 0;
let DREAM_FIRST = 2500;
let DREAM_GAP = 14000;

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
  clearTimeout(dreamTimer);
  if (!$("screen-app").classList.contains("active")) return;
  if (curMood === "sleepy") {
    feel(baseMood());
    if (dreamCount > 0) {
      dreamCount = 0;
      setTimeout(() => addMessage(say("dreamWake"), "ai"), 500);
    }
  }
  armSleep(SLEEP_MS);
}

// Fall asleep after the quiet time, but not while the AI is talking
function armSleep(ms) {
  clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => {
    if (!$("screen-app").classList.contains("active")) return;
    if (busy) { armSleep(2000); return; }
    feel("sleepy");
    dreamCount = 0;
    scheduleDream(DREAM_FIRST);
  }, ms);
}

// While the AI sleeps it dreams out loud (up to 3 dreams)
function scheduleDream(ms) {
  clearTimeout(dreamTimer);
  dreamTimer = setTimeout(() => {
    if (curMood !== "sleepy" || busy) return;
    addDream();
    if (dreamCount < 3) scheduleDream(DREAM_GAP);
  }, ms);
}

function addDream() {
  const el = document.createElement("div");
  el.className = "msg dream";
  el.textContent = say("dream", { d: makeDream() });
  $("chat").appendChild(el);
  $("chat").scrollTop = $("chat").scrollHeight;
  dreamCount++;
  sfx("dream");
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
  dream: () => { tone(880, 0, 0.6, 0.025); tone(659.25, 0.25, 0.8, 0.02); tone(783.99, 0.5, 0.9, 0.015); },
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
  syncStartBtn();
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
  submitName();
});
$("startBtn").addEventListener("click", submitName);
$("nameInput").addEventListener("input", syncStartBtn);

// The button says "Continue" when a saved AI is waiting and the name box is empty
function syncStartBtn() {
  const existing = load();
  $("startBtn").textContent = !$("nameInput").value.trim() && existing && existing.name ? "Continue" : "Start";
}

function submitName() {
  const value = $("nameInput").value.trim();
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
}

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
  lesson = null;
  $("quality").classList.add("hidden");
  clearTimeout(dreamTimer);
  dreamCount = 0;
  if (state.lessons == null) state.lessons = state.memories.length;
  if (state.think == null) state.think = Math.floor(state.lessons / 4);
  setMode(null);

  const forgotten = purgeOld();
  updateCount();
  feel(baseMood());
  bump();
  sfx("wake");

  if (returning && state.memories.length > 0) {
    respond(say("greetBack", { name: state.name, n: state.memories.length, things: state.memories.length === 1 ? "thing" : "things" }), false, 800, { then: offerTopics });
  } else if (returning) {
    respond(say("greetEmpty", { name: state.name }), false, 800, { then: offerTopics });
  } else {
    respond(say("greetNew", { name: state.name }), false, 800, { then: offerTopics });
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
  if (lesson && lesson.stage === "claim") { claimInput(text); return; }
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
      if (opts.decorate) opts.decorate(el);
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
  if (lesson && mode === "teach" && lesson.stage === "teach") {
    $("chatInput").placeholder = "Teach me about " + lesson.topic.name + "... (example: " + lesson.topic.ex + ")";
  } else if (mode === "teach") {
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

  const silly = sillyCheck(clean);   // the AI does not know it is wrong: it just believes what it is taught
  const mem = { text: clean, time: Date.now(), silly: silly || undefined };
  state.memories.push(mem);
  state.lessons = (state.lessons || 0) + 1;
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
  let opts = {};
  if (lesson && !fix && lesson.stage === "teach") {
    lesson.facts++;
    if (lesson.garbage > 0 && lesson.lastBad) {
      reply += " " + say("glitch", { bad: lesson.lastBad });
      opts.mood = "confused";
    }
    if (lesson.facts >= lesson.nextClaimAt && lesson.claimIdx < lesson.claims.length) opts.then = askClaim;
  } else if (next) opts = { then: () => askNext(next) };
  else if (!fix && thinkDue()) opts = { then: showThink };
  respond(reply, true, 800, opts);
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

/* ---------- "Think about it" prompts and the "Oops moment" ---------- */
const THINK_Q = [
  "How does your AI know what it knows? Where did its knowledge come from?",
  "What can your AI do well? What can it NOT do yet?",
  "What happens if you teach your AI something wrong? Why is that a problem?",
  "Would you trust your AI to help with your homework? Why or why not?",
  "Your AI only knows what you taught it. Can a real AI know things that nobody taught it? How?",
  "Does your AI understand your words, or does it only match words? What do you think?",
  "If 100 students taught the same AI, what could go wrong?",
  "How is learning for an AI different from learning for you?"
];

// A new question after every 4th lesson
function thinkDue() { return (state.lessons || 0) >= 4 * ((state.think || 0) + 1); }

function showThink() {
  const q = THINK_Q[(state.think || 0) % THINK_Q.length];
  state.think = (state.think || 0) + 1;
  save();
  respond(say("thinkIntro"), false, 700, { decorate: (el) => addThinkBox(el, q) });
}

function addThinkBox(el, q) {
  const box = document.createElement("div");
  box.className = "think-box";
  const title = document.createElement("b");
  title.className = "think-title";
  title.textContent = "Think about it";
  const qp = document.createElement("p");
  qp.className = "think-q";
  qp.textContent = q;
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 240;
  input.placeholder = "Your thought (optional)";
  input.setAttribute("aria-label", "Your thought");
  const fb = document.createElement("div");
  fb.className = "fb";
  const share = document.createElement("button");
  share.type = "button";
  share.textContent = "Share my thought";
  const skip = document.createElement("button");
  skip.type = "button";
  skip.textContent = "Skip";
  const lock = () => { input.disabled = true; share.disabled = true; skip.disabled = true; };
  const send = () => {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    if (busy) return;
    if (isBlocked(v)) { input.value = ""; userSay(v); respond(say("kind"), false); return; }
    lock();
    userSay(v);
    respond(say("thinkThanks"), true, 700);
  };
  share.addEventListener("click", send);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
  skip.addEventListener("click", () => { if (busy) return; lock(); respond(say("thinkSkip"), false, 400); });
  fb.append(share, skip);
  box.append(title, qp, input, fb);
  el.appendChild(box);
}

/* A small fact-checker. The AI itself never checks: it believes everything it is taught.
   The checker only decides when the pop-up should teach the lesson later. */
const NUMWORDS_MAP = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, "twenty-four": 24,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
const NUM_PAT = "\\d+|" + Object.keys(NUMWORDS_MAP).sort((a, b) => b.length - a.length).join("|");
function numVal(w) {
  w = w.toLowerCase();
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  return Object.prototype.hasOwnProperty.call(NUMWORDS_MAP, w) ? NUMWORDS_MAP[w] : null;
}
function singular(w) {
  w = w.toLowerCase();
  if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + "y";
  if (/(ss|us|is)$/.test(w)) return w;
  return /s$/.test(w) && w.length > 3 ? w.slice(0, -1) : w;
}
const NO_FLY = ["cat", "dog", "cow", "horse", "fish", "pig", "sheep", "goat", "elephant", "lion", "tiger", "bear", "rabbit", "mouse", "turtle",
  "snake", "frog", "wolf", "fox", "deer", "monkey", "giraffe", "human", "person", "people", "student", "teacher", "boy", "girl", "car", "table", "chair", "book", "tree", "house"];
const SILLY_ADJ = {
  sky: ["green", "brown", "purple"], grass: ["blue", "red", "pink", "purple", "black", "white", "orange"],
  snow: ["black", "green", "red", "purple", "pink", "hot", "warm"], banana: ["blue", "purple", "pink"],
  sun: ["cold", "freezing", "green", "blue", "purple"], fire: ["cold", "wet", "freezing"], ice: ["hot", "warm", "dry"],
  water: ["dry"], milk: ["blue", "green", "red", "black"], sugar: ["salty", "sour"], lemon: ["sweet", "blue"], blood: ["blue", "green"]
};
const LEGS = { cat: 4, dog: 4, cow: 4, horse: 4, sheep: 4, pig: 4, goat: 4, lion: 4, tiger: 4, elephant: 4, bird: 2, human: 2, person: 2, people: 2,
  duck: 2, chicken: 2, spider: 8, ant: 6, bee: 6, insect: 6 };
const COUNTS = [["week", "days", 7], ["year", "months", 12], ["day", "hours", 24], ["hour", "minutes", 60], ["minute", "seconds", 60], ["triangle", "sides", 3], ["square", "sides", 4]];
const CAPITALS = { france: "Paris", turkey: "Ankara", turkiye: "Ankara", england: "London", italy: "Rome", spain: "Madrid", germany: "Berlin",
  japan: "Tokyo", greece: "Athens", egypt: "Cairo", russia: "Moscow", china: "Beijing", canada: "Ottawa", brazil: "Brasilia" };
const plainWord = (w) => w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");

// Returns a sentence about the real world when a fact is clearly wrong, otherwise null
function sillyCheck(fact) {
  const t = fact.replace(/\s+/g, " ").trim();
  const low = t.toLowerCase().replace(/[.!?]+$/, "");
  if (/\b(not|never|cannot|can't|isn't|aren't|don't|doesn't|no)\b/.test(low)) return null;
  const sp = splitFact(t);
  const subjLow = sp ? sp.subj.toLowerCase() : "";
  const head = sp ? singular(sp.subj.split(/\s+/).pop().replace(/'s$/i, "").replace(/[^A-Za-z]/g, "")) : "";
  const pred = sp ? sp.pred.toLowerCase() : "";
  const be = pred.split(/\s+/)[0];

  if (sp && NO_FLY.includes(head) && /\b(fly|flies|flying)\b/.test(pred)) return "In real life, " + subjLow + " cannot fly.";
  if (sp && SILLY_ADJ[head] && /^(is|are)\b/.test(pred)) {
    const bad = SILLY_ADJ[head].find((c) => new RegExp("\\b" + c + "\\b").test(pred));
    if (bad) return "In real life, " + subjLow + " " + be + " not " + bad + ".";
  }
  const legs = low.match(new RegExp("\\b(?:has|have)\\s+(" + NUM_PAT + ")\\s+legs?\\b"));
  if (sp && legs && LEGS[head] !== undefined) {
    const n = numVal(legs[1]);
    if (n !== null && n !== LEGS[head]) return "In real life, " + subjLow + " usually " + (pred.startsWith("has") ? "has" : "have") + " " + LEGS[head] + " legs.";
  }
  for (const [h, unit, n] of COUNTS) {
    const m = low.match(new RegExp("\\b" + h + "s?\\s+(?:has|have|is|are|contains)\\s+(?:only\\s+|about\\s+)?(" + NUM_PAT + ")\\s+" + unit + "\\b"));
    if (m) {
      const v = numVal(m[1]);
      if (v !== null && v !== n) return "In real life, " + (h === "hour" ? "an" : "a") + " " + h + " has " + n + " " + unit + ".";
    }
  }
  const c1 = low.match(/capital (?:city )?of (?:the )?([a-zçğıöşü]+) is (?:the city of )?([a-zçğıöşü]+)/);
  const c2 = low.match(/^(?:the city of )?([a-zçğıöşü]+) is the capital (?:city )?of (?:the )?([a-zçğıöşü]+)/);
  const pair = c1 ? { country: c1[1], city: c1[2] } : c2 ? { country: c2[2], city: c2[1] } : null;
  if (pair) {
    const real = CAPITALS[plainWord(pair.country)];
    if (real && plainWord(real) !== plainWord(pair.city)) return "In real life, the capital of " + cap(pair.country) + " is " + real + ".";
  }
  const sum = low.match(/(\d+)\s*(\+|-|x|\*|plus|minus|times)\s*(\d+)\s*(?:=|is|equals)\s*(\d+)/);
  if (sum) {
    const a = +sum[1], b = +sum[3], c = +sum[4], op = sum[2];
    const r = (op === "+" || op === "plus") ? a + b : (op === "-" || op === "minus") ? a - b : a * b;
    if (r !== c) return "In real life, " + a + " " + ({ plus: "+", minus: "-", times: "x", "*": "x" }[op] || op) + " " + b + " = " + r + ".";
  }
  if (/\b(earth|world)\b.*\b(flat|square|cube|triangle)\b/.test(low)) return "In real life, the Earth is round, almost like a ball.";
  if (/\bmoon\b.*\bcheese\b/.test(low)) return "In real life, the Moon is made of rock, not cheese.";
  return null;
}

// Show the pop-up the first time the AI repeats a wrong fact
let oopsMem = null;
function maybeOops(mem) {
  if (lesson || !mem || !mem.silly || mem.oopsShown) return;
  setTimeout(() => showOops(mem), 700);
}
function showOops(mem) {
  if (!$("screen-app").classList.contains("active") || !state.memories.includes(mem)) return;
  mem.oopsShown = true;
  save();
  oopsMem = mem;
  $("oopsFact").textContent = "“" + mem.text.replace(/[.!?]+$/, "") + ".”";
  $("oopsReal").textContent = mem.silly;
  $("oops").classList.remove("hidden");
  sfx("oops");
  $("oopsFix").focus();
}
function closeOops() {
  $("oops").classList.add("hidden");
  oopsMem = null;
}
$("oopsFix").addEventListener("click", () => {
  const mem = oopsMem;
  closeOops();
  if (busy || !mem) return;
  setMode("teach");
  pending = null;
  correction = { mem };
  respond(say("wrongFact"), false, 400, { mood: "sorry" });
});
$("oopsKeep").addEventListener("click", () => {
  closeOops();
  if (!busy) respond(say("oopsKeep"), false, 400);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("oops").classList.contains("hidden")) closeOops();
});

/* ---------- Dreams ---------- */
const DREAM_ACTIONS = ["dancing on the moon", "wearing a tiny hat", "flying over the school", "eating a giant pizza", "singing in the rain",
  "swimming in a sea of jelly", "riding a rainbow", "sleeping on a cloud"];

function shuffle(a) { return a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]); }

// Split a taught sentence into subject + predicate ("Cats" + "have 4 legs")
function splitFact(fact) {
  const clean = fact.replace(/[.!?]+$/, "").trim();
  const words = clean.split(/\s+/);
  if (/^(i|my|we)$/i.test(words[0])) return null;
  const idx = words.findIndex((w, i) => i > 0 && VERBS.includes(w.toLowerCase().replace(/[^a-z']/g, "")));
  if (idx < 1 || idx > 3) return null;
  const subj = words.slice(0, idx).join(" ");
  const pred = words.slice(idx).join(" ");
  const info = analyzeFact(clean);
  const head = words[idx - 1].replace(/'s$/i, "").replace(/[^A-Za-z]/g, "");
  return {
    subj, pred,
    pl: info ? info.pl : isPlural(head),
    safe: !/\b(they|them|their|it|its|he|she|his|her|you|your|we|our|i|my)\b/i.test(pred)
  };
}

// The AI mixes up what it knows. Mixed sentences must stay grammatical (same number, no pronouns).
function makeDream() {
  const parts = state.memories.map((m) => splitFact(m.text)).filter(Boolean);
  if (parts.length === 0) return "I was floating in a sea of letters... A, B, C, D...";
  if (parts.length >= 2 && Math.random() < 0.7) {
    const order = shuffle(parts);
    for (const a of order) {
      for (const b of order) {
        if (a === b || !b.safe || a.subj.toLowerCase() === b.subj.toLowerCase()) continue;
        if (/^can\b/i.test(b.pred) || a.pl === b.pl) return cap(a.subj) + " " + b.pred;
      }
    }
  }
  const a = pick(parts);
  return cap(a.subj) + " " + (a.pl ? "were " : "was ") + pick(DREAM_ACTIONS);
}

// Talk to the student: "My name is Ali" becomes "Your name is Ali"
function toYou(t) {
  const keep = (m, you) => (m[0] === m[0].toUpperCase() ? cap(you) : you);
  return t
    .replace(/^i am\b/i, "You are").replace(/^i'm\b/i, "You are").replace(/^i\b/i, "You")
    .replace(/\bmyself\b/gi, (m) => keep(m, "yourself"))
    .replace(/\bmine\b/gi, (m) => keep(m, "yours"))
    .replace(/\bmy\b/gi, (m) => keep(m, "your"))
    .replace(/\bme\b/gi, (m) => keep(m, "you"));
}

/* ---------- The GIGO lesson: Garbage In, Garbage Out ---------- */
// Each claim: s = what "another user" says, truth, right = what the AI believes if the student answers correctly,
// wrong = what it believes if the student answers wrongly, q = quiz question
const TOPICS = [
  { id: "cats", name: "cats", label: "Cats", ex: "Cats have four legs", claims: [
    { s: "Cats bark.", sp: ["Cats say woof.", "Do cats say woof?"], truth: false, right: "Cats meow.", wrong: "Cats bark.", q: "Do cats bark?" },
    { s: "Cats can fly.", sp: ["Cats have wings.", "Do cats have wings?"], truth: false, right: "Cats cannot fly.", wrong: "Cats can fly.", q: "Can cats fly?" },
    { s: "Cats have whiskers.", sp: ["Cats have smooth faces.", "Do cats have smooth faces?"], truth: true, right: "Cats have whiskers.", wrong: "Cats do not have whiskers.", q: "Do cats have whiskers?" },
    { s: "Cats purr when they are happy.", sp: ["Cats are always silent.", "Are cats always silent?"], truth: true, right: "Cats purr when they are happy.", wrong: "Cats never purr.", q: "Do cats purr?" } ] },
  { id: "dogs", name: "dogs", label: "Dogs", ex: "Dogs like bones", claims: [
    { s: "Dogs lay eggs.", sp: ["Baby dogs hatch from eggs.", "Do baby dogs hatch from eggs?"], truth: false, right: "Dogs do not lay eggs.", wrong: "Dogs lay eggs.", q: "Do dogs lay eggs?" },
    { s: "Dogs can talk like people.", sp: ["Dogs can read books.", "Can dogs read books?"], truth: false, right: "Dogs cannot talk like people.", wrong: "Dogs can talk like people.", q: "Can dogs talk like people?" },
    { s: "Dogs have a great sense of smell.", sp: ["Dogs cannot find food by smell.", "Can dogs find food by smell?"], truth: true, right: "Dogs have a great sense of smell.", wrong: "Dogs have a bad sense of smell.", q: "Do dogs have a good sense of smell?" },
    { s: "Dogs are mammals.", sp: ["Dogs have feathers.", "Do dogs have feathers?"], truth: true, right: "Dogs are mammals.", wrong: "Dogs are birds.", q: "Are dogs mammals or birds?" } ] },
  { id: "birds", name: "birds", label: "Birds", ex: "Birds have wings", claims: [
    { s: "Birds have four legs.", sp: ["Birds cannot stand on two legs.", "Can birds stand on two legs?"], truth: false, right: "Birds have two legs.", wrong: "Birds have four legs.", q: "How many legs do birds have?" },
    { s: "Birds are mammals.", sp: ["Baby birds drink milk.", "Do baby birds drink milk?"], truth: false, right: "Birds are not mammals.", wrong: "Birds are mammals.", q: "Are birds mammals?" },
    { s: "Birds have feathers.", sp: ["Birds are covered in fur.", "Are birds covered in fur?"], truth: true, right: "Birds have feathers.", wrong: "Birds do not have feathers.", q: "Do birds have feathers?" },
    { s: "Most birds can fly.", sp: ["Birds live only on the ground.", "Where do birds live?"], truth: true, right: "Most birds can fly.", wrong: "Birds can never fly.", q: "Can birds fly?" } ] },
  { id: "fish", name: "fish", label: "Fish", ex: "Fish live in water", claims: [
    { s: "Fish live on land.", sp: ["Fish die in water.", "Do fish die in water?"], truth: false, right: "Fish live in water.", wrong: "Fish live on land.", q: "Where do fish live?" },
    { s: "Fish have legs.", sp: ["Fish walk on the beach.", "Can fish walk on the beach?"], truth: false, right: "Fish do not have legs.", wrong: "Fish have legs.", q: "Do fish have legs?" },
    { s: "Fish breathe with gills.", sp: ["Fish cannot breathe in water.", "Can fish breathe in water?"], truth: true, right: "Fish breathe with gills.", wrong: "Fish breathe with lungs, like us.", q: "How do fish breathe?" },
    { s: "Fish can swim.", sp: ["Fish cannot move in water.", "Can fish move in water?"], truth: true, right: "Fish can swim.", wrong: "Fish cannot swim.", q: "Can fish swim?" } ] },
  { id: "sun", name: "the sun", label: "The sun", ex: "The sun is very big", claims: [
    { s: "The sun is cold.", sp: ["Ice cream never melts in the sun.", "Does ice cream melt in the sun?"], truth: false, right: "The sun is very hot.", wrong: "The sun is cold.", q: "Is the sun hot or cold?" },
    { s: "The sun is a planet.", sp: ["The sun goes around the Earth.", "Does the sun go around the Earth?"], truth: false, right: "The sun is a star.", wrong: "The sun is a planet.", q: "Is the sun a planet?" },
    { s: "The sun gives us light.", sp: ["Daytime is dark.", "Is daytime dark?"], truth: true, right: "The sun gives us light.", wrong: "The sun gives us no light.", q: "Does the sun give us light?" },
    { s: "The sun rises in the morning.", sp: ["We see the sun at midnight.", "Can we see the sun at midnight?"], truth: true, right: "The sun rises in the morning.", wrong: "The sun rises at night.", q: "When does the sun rise?" } ] }
];
const GIGO_Q = "How can you check if information is true before you give it to an AI?";
let lesson = null;   // { topic, claims, facts, nextClaimAt, claimIdx, stage, garbage, lastBad, results, cur, btns }

function updateQuality() {
  const q = lesson ? Math.max(0, 100 - 25 * lesson.garbage - 10 * lesson.spreads) : 100;
  $("quality").classList.remove("hidden");
  $("qLabel").textContent = "Data quality: " + q + "%";
  $("qFill").style.width = Math.max(q, 4) + "%";
  $("qFill").style.background = "hsl(" + Math.round(q * 1.1) + ", 80%, 50%)";
}

function offerTopics() {
  lesson = null;
  setMode(null);
  $("modeLabel").textContent = "";
  respond(say("topicAsk"), false, 500, { decorate: (el) => {
    const fb = document.createElement("div");
    fb.className = "fb";
    TOPICS.forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t.label;
      b.addEventListener("click", () => {
        if (busy) return;
        fb.querySelectorAll("button").forEach((x) => { x.disabled = true; });
        userSay("Let's talk about " + t.name + "!");
        startLesson(t);
      });
      fb.appendChild(b);
    });
    el.appendChild(fb);
  } });
}

function startLesson(topic) {
  const removed = state.memories.filter((m) => m.gigo).length;
  if (removed) { state.memories = state.memories.filter((m) => !m.gigo); save(); updateCount(); }
  // Three claims, always at least one true and one false
  let claims;
  do { claims = shuffle(topic.claims).slice(0, 3); } while (!claims.some((c) => c.truth) || claims.every((c) => c.truth));
  lesson = { topic, claims, facts: 0, nextClaimAt: 2, claimIdx: 0, stage: "teach", garbage: 0, spreads: 0, mems: [], lastBad: null, results: [], cur: null, btns: [] };
  updateQuality();
  setMode("teach");
  refreshPlaceholder();
  respond(say("lessonIntro", { topic: topic.name, ex: topic.ex }), false, 700);
}

function askClaim() {
  lesson.stage = "claim";
  const claim = lesson.claims[lesson.claimIdx++];
  lesson.cur = claim;
  lesson.btns = [];
  lesson.nextClaimAt = lesson.facts + 2;
  $("chatInput").placeholder = "Type yes or no...";
  respond(say("claimIntro", { claim: claim.s }), false, 900, { mood: "curious", decorate: (el) => {
    const fb = document.createElement("div");
    fb.className = "fb";
    [["Yes, it is true", true], ["No, it is false", false]].forEach(([label, val]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", () => { if (!busy && lesson && lesson.stage === "claim") answerClaim(val, label + "!"); });
      lesson.btns.push(b);
      fb.appendChild(b);
    });
    el.appendChild(fb);
  } });
}

function claimInput(text) {
  const t = text.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(yes|yeah|yep|true|right|correct|sure|it is true|it's true|that is true|that's true|of course)\b/.test(t)) { answerClaim(true); return; }
  if (/^(no|nope|false|wrong|not true|it is false|it's false|that is false|that's false|never|incorrect)\b/.test(t)) { answerClaim(false); return; }
  respond("Please answer yes (it is true) or no (it is false).", false, 300);
}

function answerClaim(says, userText) {
  if (!lesson || lesson.stage !== "claim" || busy) return;
  const claim = lesson.cur;
  lesson.btns.forEach((b) => { b.disabled = true; });
  if (userText) userSay(userText);
  const correct = says === claim.truth;
  const belief = correct ? claim.right : claim.wrong;
  const mem = { text: belief, time: Date.now(), gigo: correct ? undefined : true, src: "user", kind: "root" };
  state.memories.push(mem);
  lesson.mems.push(mem);
  state.lessons = (state.lessons || 0) + 1;
  let spreadMem = null;
  if (!correct) {
    lesson.garbage++;
    lesson.lastBad = belief;
    // Garbage spreads: the AI "reasons" from the wrong fact and invents more wrong facts
    spreadMem = { text: claim.sp[0], time: Date.now(), gigo: true, src: "spread", kind: "spread", sq: claim.sp[1] };
    state.memories.push(spreadMem);
    lesson.mems.push(spreadMem);
    lesson.spreads++;
  }
  lesson.results.push({ claim, correct, belief, mem });
  save();
  updateCount();
  updateQuality();
  const key = correct ? (claim.truth ? "claimOkTrue" : "claimOkFalse") : (claim.truth ? "claimBadTrue" : "claimBadFalse");
  const last = lesson.claimIdx >= lesson.claims.length;
  lesson.stage = last ? "quiz" : "teach";
  refreshPlaceholder();
  let text = say(key, { belief });
  if (spreadMem) text += " " + say("spreadNote", { spread: spreadMem.text });
  if (!last) text += " Keep teaching me about " + lesson.topic.name + "!";
  respond(text, correct, 800, { mood: correct ? undefined : "confused", then: last ? startQuiz : undefined });
}

function startQuiz() {
  lesson.stage = "quiz";
  setMode("ask");
  $("chatInput").disabled = true;
  $("sendBtn").disabled = true;
  // One question for each claim, then one for each fact that spread
  lesson.quizItems = lesson.results.map((r) => ({ q: r.claim.q, mem: r.mem, belief: r.belief, correct: r.correct, spread: false }))
    .concat(lesson.mems.filter((m) => m.kind === "spread").map((m) => ({ q: m.sq, mem: m, belief: m.text, correct: false, spread: true })));
  respond(say("quizIntro", { topic: lesson.topic.name }), false, 800, { then: () => quizStep(0) });
}

function quizStep(i) {
  const it = lesson.quizItems[i];
  const known = state.memories.includes(it.mem);   // the student may have deleted it in the Brain view
  const more = i + 1 < lesson.quizItems.length;
  it.known = known;
  const text = "Question: " + it.q + "\n" + (known ? "My memory says: \"" + it.belief + "\"" : "My memory says: nothing. I forgot it, so I do not know.");
  const bad = known && !it.correct;
  respond(text, known && it.correct, 1000, {
    mood: bad ? "confused" : "happy",
    decorate: (el) => addGigoTag(el, !known ? "No data" : it.correct ? "Good data out" : it.spread ? "Garbage out (spread)" : "Garbage out", known && it.correct),
    then: more ? () => quizStep(i + 1) : lessonReport
  });
}

function addGigoTag(el, text, good) {
  const t = document.createElement("span");
  t.className = "gigo-tag" + (good ? " good" : "");
  t.textContent = text;
  el.appendChild(document.createElement("br"));
  el.appendChild(t);
}

function lessonReport() {
  const L = lesson;
  const n = L.quizItems.length;
  const outs = L.quizItems.filter((x) => x.known && !x.correct).length;
  const r = n - outs;
  const wrongIn = L.results.filter((x) => !x.correct).length;
  const spreadIn = L.mems.filter((m) => m.kind === "spread").length;
  lesson = null;   // the lesson is over; free training and asking work again
  respond(say(outs === 0 ? "lessonReportGood" : "lessonReportBad", { r, n }), outs === 0, 900, { mood: outs === 0 ? "excited" : "sorry", decorate: (el) => {
    const flow = document.createElement("span");
    flow.className = "gigo-flow";
    flow.textContent = "Wrong facts in: " + wrongIn + "\nFacts that spread: " + spreadIn + "\nWrong answers out: " + outs + "\n\nGarbage IN → Garbage OUT. Good data IN → Good answers OUT.";
    flow.style.whiteSpace = "pre-line";
    const fb = document.createElement("div");
    fb.className = "fb";
    const again = document.createElement("button");
    again.type = "button";
    again.textContent = "New topic";
    again.addEventListener("click", () => { if (busy) return; again.disabled = true; offerTopics(); });
    fb.appendChild(again);
    const look = document.createElement("button");
    look.type = "button";
    look.textContent = "Open the Brain view";
    look.addEventListener("click", openBrain);
    fb.appendChild(look);
    if (state.memories.some((m) => m.gigo)) {
      const clean = document.createElement("button");
      clean.type = "button";
      clean.textContent = "Clean up my AI";
      clean.addEventListener("click", () => {
        if (busy) return;
        clean.disabled = true;
        state.memories = state.memories.filter((m) => !m.gigo);
        save();
        updateCount();
        sfx("pop");
        respond("All clean! The wrong facts are gone.", true, 500);
      });
      fb.appendChild(clean);
    }
    el.append(flow, fb);
    addThinkBox(el, GIGO_Q);
    setMode("ask");
  } });
}

/* ---------- Brain view: see everything the AI believes, and delete the garbage ---------- */
function isWrongMem(m) { return !!(m.gigo || m.silly); }

function forgetMem(m) {
  state.memories = state.memories.filter((x) => x !== m);
  save();
  updateCount();
  if (lesson && lesson.mems && lesson.mems.includes(m)) {
    if (m.kind === "spread") lesson.spreads = Math.max(0, lesson.spreads - 1);
    else if (m.gigo) lesson.garbage = Math.max(0, lesson.garbage - 1);
    updateQuality();
  }
}

function renderBrain() {
  const list = $("brainList");
  list.innerHTML = "";
  const mems = state.memories.slice();
  const bad = mems.filter(isWrongMem).length;
  $("brainCount").textContent = mems.length === 0 ? "My brain is empty." : mems.length + (mems.length === 1 ? " fact" : " facts") + " in my brain, " + bad + " wrong.";
  mems.forEach((m) => {
    const row = document.createElement("div");
    row.className = "brain-row" + (isWrongMem(m) ? " wrong" : "");
    const t = document.createElement("div");
    t.className = "brain-text";
    const fact = document.createElement("span");
    fact.textContent = m.text;
    const src = document.createElement("small");
    src.textContent = m.src === "spread" ? "Spread by the AI (it guessed this from a wrong fact)"
      : m.src === "user" ? (m.gigo ? "From another user. You said yes." : "From another user. You checked it.")
      : "Taught by you" + (m.silly ? " (looks wrong)" : "");
    t.append(fact, src);
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Delete";
    del.setAttribute("aria-label", "Delete: " + m.text);
    del.addEventListener("click", () => { forgetMem(m); sfx("pop"); renderBrain(); });
    row.append(t, del);
    list.appendChild(row);
  });
}
function openBrain() {
  renderBrain();
  $("brain").classList.remove("hidden");
  $("brainClose").focus();
}
function closeBrain() { $("brain").classList.add("hidden"); }
$("brainBtn").addEventListener("click", openBrain);
$("brainClose").addEventListener("click", closeBrain);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("brain").classList.contains("hidden")) closeBrain(); });

$("topicBtn").addEventListener("click", () => { if (!busy) offerTopics(); });

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
    const sure = smart.ok && smart.mem && (smart.mem.silly || smart.mem.gigo);   // a wrong fact, repeated with total confidence
    const o = {
      conf: sure ? 99 : smart.conf, guess: smart.guess, mem: smart.mem, mood: smart.ok ? undefined : "confused",
      decorate: () => maybeOops(smart.ok ? smart.mem : null)
    };
    respond(smart.text, smart.ok, 800, o);
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
  const ro = top.length === 1 && top[0].m.silly ? { decorate: () => maybeOops(top[0].m) } : {};
  respond(reply, true, 1100, ro);
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
