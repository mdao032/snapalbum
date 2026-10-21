import { describe, expect, it } from "vitest";
import { androidChromeIntent, detectInAppBrowser } from "./in-app-browser";

const UA = {
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 340.0.0.30.109 (iPhone15,2; iOS 17_5; fr_FR)",
  facebookAndroid:
    "Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.0]",
  messenger:
    "Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36 [FB_IAB/MESSENGER;FBAV/450.0]",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/460.0.0.0;]",
  wechat:
    "Mozilla/5.0 (Linux; Android 12; wv) AppleWebKit/537.36 Chrome/111.0 Mobile MicroMessenger/8.0.40",
  tiktok:
    "Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 BytedanceWebview/d8a21c6",
  genericWebview:
    "Mozilla/5.0 (Linux; Android 11; Redmi Note 9 Build/RP1A; wv) AppleWebKit/537.36 Version/4.0 Chrome/110.0 Mobile Safari/537.36",
};

describe("NF-023: navigateurs intégrés aux applis", () => {
  it("NF-023: un navigateur ordinaire n'est pas pris pour un navigateur intégré", () => {
    expect(detectInAppBrowser(UA.chromeAndroid)).toBeNull();
    expect(detectInAppBrowser(UA.safariIos)).toBeNull();
    expect(detectInAppBrowser("")).toBeNull();
  });

  it("NF-023: reconnaît Instagram, Facebook, Messenger, WeChat et TikTok", () => {
    expect(detectInAppBrowser(UA.instagramIos)).toBe("instagram");
    expect(detectInAppBrowser(UA.facebookAndroid)).toBe("facebook");
    expect(detectInAppBrowser(UA.facebookIos)).toBe("facebook");
    expect(detectInAppBrowser(UA.messenger)).toBe("messenger");
    expect(detectInAppBrowser(UA.wechat)).toBe("wechat");
    expect(detectInAppBrowser(UA.tiktok)).toBe("tiktok");
  });

  it("NF-023: une vue web Android sans marque d'appli est tout de même repérée", () => {
    expect(detectInAppBrowser(UA.genericWebview)).toBe("webview");
  });

  it("NF-023: le lien d'ouverture dans Chrome garde le chemin et ne sert qu'à http(s)", () => {
    expect(androidChromeIntent("https://snapalbum.test/e/k7m2x9qvbr?x=1")).toBe(
      "intent://snapalbum.test/e/k7m2x9qvbr?x=1#Intent;scheme=https;package=com.android.chrome;end",
    );
    expect(androidChromeIntent("javascript:alert(1)")).toBeNull();
    expect(androidChromeIntent("pas une adresse")).toBeNull();
  });
});
