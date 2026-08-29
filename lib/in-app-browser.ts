/**
 * v1.42.0 — is this page running inside another app's browser?
 *
 * THE PROBLEM THIS EXISTS FOR. On 29-08-2026 a customer reached Maybank2u
 * through Billplz and was told:
 *
 *     You have been logged out. Access denied.
 *
 * Nothing was wrong with the order, the bill, or the redirect. Malaysian bank
 * logins refuse to run inside an app's embedded browser — the webview that
 * opens when somebody taps a link in TikTok, Instagram or Facebook rather
 * than in Chrome or Safari. The bank sees a session it will not trust and
 * ends it.
 *
 * That failure lands on ELFIA harder than on most shops, because most of this
 * shop's customers arrive by tapping a link in TikTok. They never chose an
 * in-app browser; they just tapped a video.
 *
 * A shop cannot fix a bank's policy. What it can do is say so BEFORE the
 * customer spends two minutes typing bank credentials into a page that was
 * always going to refuse them, and give them the one action that works.
 *
 * DETECTION IS A HINT, NOT A GATE. User-agent sniffing is guesswork: apps
 * change their strings, and some webviews do complete a payment. So this
 * only ever adds a warning and never blocks the button — a customer who
 * knows better can still tap Pay, and bank transfer is on the same page
 * either way. A false positive costs one dismissible sentence. A false
 * negative leaves things exactly as they are today.
 */

export interface InAppBrowser {
  inApp: boolean;
  /** What to call it in the warning, e.g. "TikTok". Empty when not in-app. */
  app: string;
  /** iOS phrases the escape differently from Android, and a wrong
      instruction is worse than none. */
  platform: "ios" | "android" | "other";
}

/* Ordered most specific first: TikTok's webview also carries "Safari" on
   iOS, so a naive browser check would call it Safari. */
const APPS: [RegExp, string][] = [
  [/\bTikTok|musical_ly|BytedanceWebview|Bytedance/i, "TikTok"],
  [/\bInstagram\b/i, "Instagram"],
  [/\bFBAN|FBAV|FB_IAB|FBIOS\b/i, "Facebook"],
  [/\bLine\//i, "LINE"],
  [/\bMicroMessenger\b/i, "WeChat"],
  [/\bTwitter|TwitterAndroid\b/i, "X"],
  [/\bSnapchat\b/i, "Snapchat"],
  [/\bPinterest\b/i, "Pinterest"],
  [/\bShopee\b/i, "Shopee"],
];

export function detectInAppBrowser(ua: string): InAppBrowser {
  const platform: InAppBrowser["platform"] =
    /iPhone|iPad|iPod/i.test(ua) ? "ios" : /Android/i.test(ua) ? "android" : "other";

  for (const [re, name] of APPS) {
    if (re.test(ua)) return { inApp: true, app: name, platform };
  }

  /* The generic Android webview: "; wv)" in the UA. Named by Google as the
     marker for an embedded WebView, and it is what most apps without their
     own token produce. */
  if (/Android.*;\s*wv\)/i.test(ua)) return { inApp: true, app: "an app", platform };

  return { inApp: false, app: "", platform };
}

/** The one instruction that actually gets them out, phrased per platform. */
export function escapeHatch(b: InAppBrowser): string {
  if (!b.inApp) return "";
  if (b.platform === "ios") {
    return "Tap the … or compass icon at the corner of this page and choose “Open in Safari”, then pay from there.";
  }
  if (b.platform === "android") {
    return "Tap the ⋮ menu at the corner of this page and choose “Open in browser” (Chrome), then pay from there.";
  }
  return "Open this page in your normal web browser, then pay from there.";
}

/** Reads the live browser. Returns "not in-app" during server rendering,
    which is correct: there is no customer there to warn. */
export function currentBrowser(): InAppBrowser {
  if (typeof navigator === "undefined") return { inApp: false, app: "", platform: "other" };
  return detectInAppBrowser(navigator.userAgent || "");
}
