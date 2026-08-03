import { REFUND_WINDOW_DAYS } from "@/app/legal/policy";
import { EXPIRY_DAYS, PACKAGE_SESSIONS, PRICE_DISPLAY, TRIAL_SESSIONS } from "@/lib/pricing";
import { SESSION_BUDGET_S } from "@/lib/session-room";

// Every sentence the landing page says, in one file.
//
// Two reasons it lives here rather than inline in the components. First, the
// register is a product decision and it is enforceable: honest and calm, no
// personas, no celebrity framing, no "undetectable", no scarcity, no
// exclamation marks. tests/landing-copy-register.test.ts fails the build on
// any of those, and it can only do that if the prose is reachable as data.
// Second, the numbers. Price, session count, trial size, validity window, and
// refund window all come from the modules that own them, so the landing can
// never quote a policy the checkout does not honour.
//
// The competitive read behind this page (Final Round, Yoodli, Himalayas) said
// the market's polish bar is: hero carries the product rather than a slogan,
// every scroll block re-offers one CTA with trial microcopy under it, framed
// real screenshots as the proof layer, a three-or-four item explainer row, and
// inline pricing plus an FAQ closing the page so objections die here.

/** Minutes a session runs, from the module that owns the session clock. */
export const SESSION_MINUTES = Math.round(SESSION_BUDGET_S / 60);

/** Under every primary CTA. The single most load-bearing line on the page. */
export const TRIAL_MICROCOPY = "First session free. No card.";

export const HERO = {
  heading: "Would you pass the interview today?",
  body:
    "Paste the job description you're facing. A live interviewer holds you to " +
    "that role's real bar — in English, out loud — and tells you honestly what " +
    "is still missing. Repeat until you would pass.",
  primaryCta: "Sign in and start",
  secondaryCta: "See a real report",
} as const;

/**
 * The hero's right pane (F-45). Its prose lives here with the rest so the
 * register test can reach it — a sentence hidden in markup is a sentence
 * nothing checks.
 */
export const PREVIEW_WIDGET = {
  eyebrow: "Before you sign up",
  heading: "See the bar this job is scored against",
  placeholder: "Paste the job description you're applying to.",
  submit: "Show me the bar",
  submitting: "Compiling the bar",
  hint: "Free, no account, nothing saved.",
  tooLong: "That is longer than the preview reads. Paste the requirements section.",
  compiling: "Reading the job description and weighing what it turns on.",
  resultLabel: "Compiled bar",
  verdictLine: "This is your bar. Sign in to face it.",
  cta: "Sign in and start",
  retry: "Try again",
  signIn: "Sign in and compile it for real",
  // What the paid compile adds is anchors and sources — NOT the question
  // bank. DECISIONS 015 seals that bank on every surface, so promising it
  // here would be selling something the product deliberately never shows.
  footnote:
    "The full compile adds the scoring anchors and the sources behind every " +
    "dimension. The questions themselves stay sealed — a bar you can rehearse " +
    "is not a bar.",
  contentChannel: "What you say",
  deliveryChannel: "How you say it",
} as const;

/** "A bit more — 40 more characters." Written here so the register sees it. */
export function tooShortHint(missing: number): string {
  return `A bit more — ${missing} more characters.`;
}

export interface Step {
  title: string;
  detail: string;
}

export const HOW_IT_WORKS: Step[] = [
  {
    title: "Paste the job description",
    detail:
      "The one you are actually applying to. It compiles into that role's " +
      "bar: the dimensions a real interview scores, weighted by how much " +
      "each one counts, with the scoring anchors and the sources behind them.",
  },
  {
    title: "Talk to your interviewer",
    detail:
      `About ${SESSION_MINUTES} minutes, out loud, in English. Speech both ` +
      "ways, so pace and hesitation stay real signal instead of being lost " +
      "in a transcript.",
  },
  {
    title: "Read the report",
    // "Every judgment is quoted back" was an overclaim: content quotes are
    // verified against the transcript and dropped when they do not match
    // (content/judge.py), and delivery evidence is timestamps into your own
    // audio rather than words. Say which is which.
    detail:
      "Two scores, kept apart: what you said, and how you said it. Content " +
      "judgments quote your own words back; delivery ones point at the " +
      "timestamps, so you can argue with either.",
  },
  {
    title: "Go again until the verdict changes",
    detail:
      `${PACKAGE_SESSIONS} sessions on one job description, fresh topics each ` +
      "time. The verdict moves from Not yet ready to Approaching to Ready — " +
      "or it says plainly what is still holding it down.",
  },
];

export interface Screenshot {
  key: string;
  title: string;
  caption: string;
  /**
   * The captured screen, or null while there is nothing honest to show.
   *
   * Real captures land after the F-21 design pass restyles the product —
   * shipping a screenshot of a UI we are about to replace would be a picture
   * of something the buyer will never see. Until then the frame renders a
   * labelled placeholder that could not be mistaken for a product shot. The
   * swap is a file into public/screens/ and one string here; no component
   * changes.
   */
  src: string | null;
}

export const SCREENSHOTS: Screenshot[] = [
  {
    key: "rubric",
    title: "The compiled bar",
    caption: "Every dimension, its weight, and the source behind it.",
    src: null,
  },
  {
    key: "room",
    title: "The session room",
    caption: "Mic check, a visible clock, and the transcript as you speak.",
    src: null,
  },
  {
    key: "report",
    title: "The scored report",
    caption: "Content and delivery scored separately, with your own words as evidence.",
    src: null,
  },
  {
    key: "progress",
    title: "Progress across sessions",
    caption: "Where you started, where you are, and what still holds the verdict down.",
    src: null,
  },
];

export const PLACEHOLDER_LABEL = "Screenshot pending — captured after the design pass";

export interface PricingLine {
  label: string;
  detail: string;
}

/**
 * The itemized unlock list (F-43), shown before the price on both the landing
 * block and checkout. Itemizing what unlocks, above the number, is the one
 * paywall pattern worth copying wholesale; scarcity timers and fake discounts
 * are the ones worth refusing.
 */
export const PRICING_LINES: PricingLine[] = [
  { label: "1 job description", detail: "One package, compiled from the JD you paste." },
  {
    label: `${PACKAGE_SESSIONS} sessions`,
    detail: `About ${SESSION_MINUTES} minutes each, fresh topics every time.`,
  },
  {
    label: "Scored reports",
    detail: "One per session: content and delivery, with evidence quoted back.",
  },
  {
    label: "A final verdict",
    detail: "Ready, Approaching, or Not yet ready — and what is missing.",
  },
  { label: `${EXPIRY_DAYS} days`, detail: "From the moment you pay." },
];

export const PRICING = {
  heading: "One package per job description.",
  price: PRICE_DISPLAY,
  priceNote: "per job description",
  trialNote:
    `Your first package starts as a free trial: ${TRIAL_SESSIONS} full session, ` +
    `scored. The ${PRICE_DISPLAY} unlock opens the rest of that same package ` +
    `for ${EXPIRY_DAYS} days.`,
  refundLine:
    `If a technical failure on our side keeps you from using what you paid ` +
    `for, tell us within ${REFUND_WINDOW_DAYS} days and we will fix it or ` +
    `refund you.`,
  cta: "Continue to payment",
} as const;

export interface FaqEntry {
  question: string;
  answer: string;
}

/**
 * The six questions people actually ask before paying. Objections die on the
 * page, not in a docs link — the answers here are the same promises the legal
 * pages make, in plainer words.
 */
export const FAQ: FaqEntry[] = [
  {
    question: "Is this a real interview?",
    answer:
      "No. It is a practice interview, run by an AI interviewer against the bar " +
      "compiled from the job description you paste. No employer sees it, and " +
      "nothing you say here reaches anyone you are applying to.",
  },
  {
    question: "What does the verdict actually mean?",
    answer:
      "There are three: Not yet ready, Approaching, and Ready. It is a judgment " +
      "against that role's bar, made from your own answers, and it comes with " +
      "what is missing. It is not a prediction that you will get the offer, and " +
      "it is never softened to keep you happy.",
  },
  {
    question: "What happens to my recording?",
    answer:
      "Delivery is scored from the raw audio, because pace, hesitation, and " +
      "pronunciation are gone the moment speech becomes text. Recordings, " +
      "transcripts, and reports sit in private storage tied to your account for " +
      "as long as the account exists. They are never public, never shared with " +
      "other users, and never used for anything but producing your own results.",
  },
  {
    question: "Can I get a refund?",
    answer:
      `If a technical failure on our side keeps you from using what you paid ` +
      `for, tell us within ${REFUND_WINDOW_DAYS} days of payment and we will ` +
      `fix it or refund you. A verdict you did not like is not grounds — if a ` +
      `disappointing verdict were refundable, you would have to wonder whether ` +
      `we soften them to keep the money.`,
  },
  {
    question: "Why is this built for non-native English speakers?",
    answer:
      "Because that is where the gap sits. A non-native speaker's strong answer " +
      "gets marked down for how it lands, and generic practice tools cannot " +
      "tell you which of the two cost you the role. Scoring content and " +
      "delivery separately, from the audio, is the only way to answer that.",
  },
  {
    question: "Do I need a headset, or will speakers do?",
    // The session room recommends headphones on its own ready screen
    // (components/SessionRoom.tsx). Claiming here that headphones are never
    // mentioned would contradict the product one click later.
    answer:
      "Either. Open speakers work — turn detection is built to survive the " +
      "echo your speakers put back into the microphone, and nothing is gated " +
      "on wearing anything. Headphones remove that echo at the source, so the " +
      "session room recommends them; that is the whole of the difference.",
  },
];

export const CLOSING = {
  heading: "Find out where you actually stand.",
  body:
    "The first session is scored in full, and the report is the same one you " +
    "would get on session six. Read it, then decide.",
  cta: "Sign in and start",
} as const;
