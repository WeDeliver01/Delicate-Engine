export function setMobileViewportHeight() {
  const setVh = () => {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty("--dvh", `${vh}px`);
  };
  setVh();
  window.addEventListener("resize", setVh);
  window.addEventListener("orientationchange", () => setTimeout(setVh, 100));
}

export function injectDriverManifest() {
  let link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
  if (link) {
    link.setAttribute("href", "/driver-manifest.json?v=3");
  } else {
    link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/driver-manifest.json?v=3";
    document.head.appendChild(link);
  }

  setOrCreateMeta("theme-color", "#1a1a2e");
  setOrCreateMeta("apple-mobile-web-app-capable", "yes");
  setOrCreateMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
  setOrCreateMeta("apple-mobile-web-app-title", "Delicate Driver");
  setOrCreateMeta("mobile-web-app-capable", "yes");

  const existingIcons = document.querySelectorAll('link[rel="apple-touch-icon"]');
  existingIcons.forEach((el) => el.remove());

  const touchIcon = document.createElement("link");
  touchIcon.rel = "apple-touch-icon";
  touchIcon.setAttribute("sizes", "180x180");
  touchIcon.href = "/driver-apple-touch-icon.png?v=3";
  document.head.appendChild(touchIcon);
}

function setOrCreateMeta(name: string, content: string) {
  let meta = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (meta) {
    meta.setAttribute("content", content);
  } else {
    meta = document.createElement("meta");
    meta.name = name;
    meta.content = content;
    document.head.appendChild(meta);
  }
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}
