/**
 * Browsers built into other apps (Instagram, Facebook, WhatsApp...) restrict storage, camera and
 * background work, and cannot be told to keep a page open (NF-023). Recognising them lets the page
 * suggest opening the link in the phone's own browser. Detection reads the user agent, which
 * these apps mark; it can miss one (never a reason to block) and the message stays a suggestion.
 */

export type InAppBrowser =
  | "instagram"
  | "facebook"
  | "messenger"
  | "whatsapp"
  | "snapchat"
  | "tiktok"
  | "line"
  | "wechat"
  | "linkedin"
  | "twitter"
  | "webview";

const MARKERS: [InAppBrowser, RegExp][] = [
  ["instagram", /Instagram/i],
  ["messenger", /FB_IAB\/MESSENGER|\bMessenger\b/i],
  ["facebook", /FBAN|FBAV|FB_IAB/],
  ["whatsapp", /WhatsApp/i],
  ["snapchat", /Snapchat/i],
  ["tiktok", /musical_ly|BytedanceWebview|TikTok/i],
  ["line", /\bLine\//i],
  ["wechat", /MicroMessenger/i],
  ["linkedin", /LinkedInApp/i],
  ["twitter", /Twitter/i],
  // Android's generic web view marks itself with "; wv)".
  ["webview", /; wv\)/],
];

/** The app whose built-in browser this is, or null for a regular browser. */
export function detectInAppBrowser(userAgent: string): InAppBrowser | null {
  for (const [app, pattern] of MARKERS) if (pattern.test(userAgent)) return app;
  return null;
}

/** An Android `intent:` link that asks Chrome to open `url` (it works from most in-app browsers). */
export function androidChromeIntent(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const rest = `${parsed.host}${parsed.pathname}${parsed.search}`;
    return `intent://${rest}#Intent;scheme=${parsed.protocol.slice(0, -1)};package=com.android.chrome;end`;
  } catch {
    return null;
  }
}
