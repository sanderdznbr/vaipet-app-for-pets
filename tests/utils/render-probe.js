import { expect } from "@playwright/test";
/**
 * Runs in the browser: is anything actually being painted right now?
 *
 * We track the *maximum* effective opacity of on-screen content, not the
 * minimum — staggered entrance animations legitimately start individual items
 * at `opacity: 0`, but at least one element must always be visible.
 */
export const PROBE = `(() => {
  const root = document.getElementById('root');
  if (!root) return null;

  let maxOpacity = 0;
  let paintedNodes = 0;
  let splashVisible = false;

  const walk = (el, inherited) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const effective = inherited * parseFloat(cs.opacity || '1');

    const rect = el.getBoundingClientRect();
    const onScreen =
      rect.width > 8 && rect.height > 8 && rect.top < innerHeight && rect.bottom > 0;

    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('');

    if (onScreen && effective > 0.05) {
      const hasArt =
        el.tagName === 'IMG' ||
        el.tagName === 'svg' ||
        el.tagName === 'CANVAS' ||
        el.tagName === 'VIDEO' ||
        cs.backgroundImage !== 'none';
      if (ownText.length > 0 || hasArt) {
        paintedNodes++;
        maxOpacity = Math.max(maxOpacity, effective);
      }
    }

    if (el.dataset && el.dataset.testid === 'splash-screen') splashVisible = true;

    for (const child of el.children) walk(child, effective);
  };

  walk(root, 1);

  return {
    url: location.pathname,
    domText: (root.textContent || '').trim().length,
    paintedNodes,
    maxOpacity,
    splashVisible,
  };
})()`;
export async function sampleRender(page, durationMs, intervalMs = 100) {
    const samples = [];
    const started = Date.now();
    while (Date.now() - started < durationMs) {
        const probe = await page.evaluate(PROBE).catch(() => null);
        if (probe)
            samples.push({ at: Date.now() - started, ...probe });
        await page.waitForTimeout(intervalMs);
    }
    return samples;
}
export function describeSamples(samples) {
    return samples
        .slice(0, 12)
        .map((s) => `  t=${s.at}ms url=${s.url} domText=${s.domText} painted=${s.paintedNodes} maxOpacity=${s.maxOpacity.toFixed(2)} splash=${s.splashVisible}`)
        .join("\n");
}
/**
 * A sample is blank when nothing visible is painted: either the DOM is empty,
 * or content exists but every on-screen node is faded/invisible.
 */
export function blankSamples(samples) {
    return samples.filter((s) => s.paintedNodes === 0 || s.maxOpacity < 0.05);
}
/**
 * Asserts the app paints within `bootBudgetMs` and then never blanks again.
 * The pre-first-paint window is expected on a hard document load (the SPA
 * bundle is still booting); the bug we guard against is blanking *after*
 * something has already been rendered.
 */
export function expectNeverBlankAfterFirstPaint(samples, label, bootBudgetMs = 4_000) {
    const firstPaint = samples.findIndex((s) => s.paintedNodes > 0 && s.maxOpacity >= 0.05);
    expect(firstPaint, `${label}: nothing was ever painted:\n${describeSamples(samples)}`).toBeGreaterThanOrEqual(0);
    expect(samples[firstPaint].at, `${label}: first paint took too long (blank screen while booting)`).toBeLessThanOrEqual(bootBudgetMs);
    const regressions = blankSamples(samples.slice(firstPaint));
    expect(regressions, `${label}: screen went blank after first paint:\n${describeSamples(regressions)}`).toHaveLength(0);
}
/**
 * Seeds the Cloud auth session when the runner provides one, so assertions can
 * cover the real logged-in app. Without it the app renders /auth, which is
 * still a valid (non-blank) render and keeps specs runnable anywhere.
 */
export async function seedSession(page) {
    const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
    const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
    if (!storageKey || !sessionJson)
        return false;
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [storageKey, sessionJson]);
    return true;
}
