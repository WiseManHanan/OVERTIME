/*
 * The palette (doc §3.1). Single source of truth is `styles.css`; this reads the
 * custom properties off :root so the canvas and the shell never drift apart.
 * Literals below are only a fallback for when computed styles aren't available.
 */

export interface Palette {
  lcdBg: string;
  segment: string;
  printRed: string;
  printBlue: string;
  printYellow: string;
}

const FALLBACK: Palette = {
  lcdBg: "#9BAE8C",
  segment: "#2B2E27",
  printRed: "#C1443A",
  printBlue: "#3E6C9B",
  printYellow: "#D9A441",
};

export function readPalette(root: Element = document.documentElement): Palette {
  const style = getComputedStyle(root);
  const prop = (name: string, fallback: string): string => {
    const value = style.getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  };
  return {
    lcdBg: prop("--lcd-bg", FALLBACK.lcdBg),
    segment: prop("--segment", FALLBACK.segment),
    printRed: prop("--print-red", FALLBACK.printRed),
    printBlue: prop("--print-blue", FALLBACK.printBlue),
    printYellow: prop("--print-yellow", FALLBACK.printYellow),
  };
}
