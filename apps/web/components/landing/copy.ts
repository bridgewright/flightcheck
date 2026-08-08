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

/**
 * What the CTA says to someone who is already signed in.
 *
 * The landing is public and a signed-in visitor lands on it often, from a
 * bookmark or the logo. It was offering them "Sign in and start" while a
 * separate line underneath told them they were signed in already, so one
 * screen said both things at once. The offer is not the same offer for them:
 * there is nothing to sign up for and no first session to promise free, so the
 * button changes and the trial microcopy comes off.
 */
export const SIGNED_IN_CTA = "Go to your home";

export const HERO = {
  heading: "Would you pass the interview today?",
  // Twenty words, counted, because the hero is a single moment and a
  // forty-word paragraph pushes the CTAs out of the first viewport
  // (taste-skill 4.7). Two phrases survived the cut on purpose: "in English"
  // and "out loud" are the whole differentiation for a non-native speaker, and
  // a subtext that saves words by dropping them has cut the wrong thing.
  //
  // What the cut cost: "Repeat until you would pass." The heading already asks
  // the question, the fourth step of how-it-works states the loop, and the
  // closing block re-offers it. "live" also went, and losing it is a small
  // gain: the interviewer is an AI, which the FAQ says plainly, and "live"
  // invited the reader to imagine a person.
  body:
    "Paste the job description. An interviewer holds you to that role's bar, " +
    "in English, out loud, and says what's missing.",
  primaryCta: "Sign in and start",
  secondaryCta: "See a real report",
} as const;

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
      `About ${SESSION_MINUTES} minutes, out loud, in English. Speech both ways, so pace and hesitation stay real signal instead of being lost in a transcript.`,
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
      `${PACKAGE_SESSIONS} sessions on one job description, with fresh topics each session and questions aimed at your weaker dimensions. Every session keeps the same scoring bar, so you can read the scores against each other.`,
  },
];

// There is no screenshot machinery here any more.
//
// A `Screenshot` interface, four captioned entries, a `PLACEHOLDER_LABEL`, a
// `HERO_SCREEN` resolved by key, and the `ScreenFrame` and `Showcase`
// components that rendered them all lived here and were imported by nothing.
// The hero's screenshot was removed by the user twice, and the showcase block
// went with the landing rebuild.
//
// They are deleted rather than parked. The placeholder read "Captured after
// the design pass", and the design pass is this one, so the promise had gone
// stale in place. Re-adding a captured screen should be a decision someone
// makes with a real file in hand, not a rediscovery of scaffolding that was
// waiting quietly for it.

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
    detail: `About ${SESSION_MINUTES} minutes each, with fresh topics that rotate and aim at weaker dimensions while the scoring bar stays fixed.`,
  },
  {
    label: "Scored reports",
    detail: "One per session: content and delivery, with evidence quoted back.",
  },
  {
    label: "A final verdict",
    detail: "Ready, Approaching, or Not yet ready, plus what is missing.",
  },
  { label: `${EXPIRY_DAYS} days`, detail: "From the moment you pay." },
];

export const PRICING = {
  heading: "One package per job description.",
  price: PRICE_DISPLAY,
  priceNote: "per job description",
  trialNote:
    `Your first package starts as a free trial: ${TRIAL_SESSIONS} full session, scored. The ${PRICE_DISPLAY} unlock opens the rest of that same package for ${EXPIRY_DAYS} days.`,
  refundLine:
    `If a technical failure on our side keeps you from using what you paid for, tell us within ${REFUND_WINDOW_DAYS} days and we will fix it or refund you.`,
  cta: "Continue to payment",
} as const;

export interface FaqEntry {
  question: string;
  answer: string;
}

/**
 * The six questions people actually ask before paying, answered at /faq.
 *
 * They used to sit on the landing page itself, under the heading "objections
 * die on the page, not in a docs link". That was the right instinct and the
 * wrong page: six accordion rows were most of the length the user asked to be
 * cut, and an accordion FAQ is on the design skills' list of patterns that
 * read as generic. They are one click away and no longer behind a policy PDF,
 * which was the part that mattered.
 *
 * The answers here are the same promises the legal pages make, in plainer
 * words.
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
      `If a technical failure on our side keeps you from using what you paid for, tell us within ${REFUND_WINDOW_DAYS} days of payment and we will fix it or refund you. A verdict you did not like is not grounds. If a disappointing verdict were refundable, you would have to wonder whether we soften them to keep the money.`,
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
      "Either. Open speakers work: turn detection is built to survive the " +
      "echo your speakers put back into the microphone, and no part of the " +
      "product is gated on headphones. Headphones remove that echo at the " +
      "source, so the session room recommends them; that is the whole of the " +
      "difference.",
  },
];

export const CLOSING = {
  heading: "Find out where you actually stand.",
  body:
    "The first session is scored in full, and the report is the same one you " +
    "would get on session six. Read it, then decide.",
  cta: "Sign in and start",
} as const;
