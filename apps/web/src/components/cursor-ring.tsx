import { useEffect, useRef } from "react";

const CLICKABLE = "a, button, [role='button'], [role='tab'], [role='menuitem'], summary, label[for], select";
const TEXT = "input:not([type='checkbox'], [type='radio'], [type='submit']), textarea, [contenteditable='true']";
/** Where the pointer is on an ink scene the ring is marigold, since teal would sink into it. */
const INK = ".bg-dusk, [data-scene-ink]";

/**
 * A soft ring that trails the pointer, swells over clickable things and shrinks on press. Over an element marked
 * `data-cursor="…"` (an event's cover) the ring gives way to a label saying what a click does. Mouse only, never under
 * reduced motion; the native cursor stays, and neither element takes a click.
 */
export function CursorRing() {
  const ring = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ring.current;
    const tag = label.current;
    if (!el || !tag || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let x = 0, y = 0, tx = 0, ty = 0, raf = 0;
    const step = () => {
      x += (tx - x) * 0.2;
      y += (ty - y) * 0.2;
      el.style.translate = `${x}px ${y}px`;
      // the label sticks closer to the pointer than the ring does
      tag.style.translate = `${tx}px ${ty}px`;
      // stop once settled; the next move restarts it
      raf = Math.hypot(tx - x, ty - y) > 0.1 ? requestAnimationFrame(step) : 0;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      tx = e.clientX;
      ty = e.clientY;
      if (el.dataset.show !== "true") {
        x = tx;
        y = ty;
        el.dataset.show = "true";
      }
      const t = e.target instanceof Element ? e.target : null;
      el.dataset.state = t?.closest(TEXT) ? "text" : t?.closest(CLICKABLE) ? "link" : "";
      el.dataset.tone = t?.closest(INK) ? "ink" : "";
      const words = t?.closest<HTMLElement>("[data-cursor]")?.dataset.cursor;
      if (words && tag.textContent !== words) tag.textContent = words;
      tag.dataset.show = String(!!words);
      el.dataset.labelled = String(!!words);
      raf ||= requestAnimationFrame(step);
    };
    const down = () => (el.dataset.down = "true");
    const up = () => delete el.dataset.down;
    const leave = () => {
      el.dataset.show = "false";
      tag.dataset.show = "false";
    };

    addEventListener("pointermove", move, { passive: true });
    addEventListener("pointerdown", down);
    addEventListener("pointerup", up);
    document.documentElement.addEventListener("mouseleave", leave);
    return () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerdown", down);
      removeEventListener("pointerup", up);
      document.documentElement.removeEventListener("mouseleave", leave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <div aria-hidden ref={ring} className="cursor-ring" />
      <div aria-hidden ref={label} className="cursor-label" />
    </>
  );
}
