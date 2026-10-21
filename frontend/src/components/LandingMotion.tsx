"use client";
import { useEffect } from "react";

/**
 * Landing-page motion, powered by GSAP + ScrollTrigger.
 *
 * Rules we follow:
 * - Content is visible by default. Every animation uses gsap.from(), set
 *   up only after mount — if JS fails or GSAP can't load, the page is
 *   simply static and fully readable.
 * - prefers-reduced-motion: no animation at all (checked before loading
 *   GSAP). CSS animations are disabled under the same query in
 *   globals.css.
 * - ScrollTrigger is imported lazily, only on this (landing) page, and all
 *   triggers/tweens are killed on unmount via gsap.context().revert().
 */
export default function LandingMotion() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelled = false;
    let ctx: { revert: () => void } | undefined;

    (async () => {
      const gsap = (await import("gsap")).default;
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);

      ctx = gsap.context(() => {
        // Headline words stagger up
        gsap.from(".gs-hero-word", {
          y: 44, autoAlpha: 0, duration: 0.9, ease: "power3.out", stagger: 0.07, delay: 0.1,
        });
        gsap.from(".gs-hero-sub", { y: 24, autoAlpha: 0, duration: 0.8, ease: "power3.out", delay: 0.55 });
        gsap.from(".gs-hero-ctas", { y: 20, autoAlpha: 0, duration: 0.8, ease: "power3.out", delay: 0.7 });

        // Hero IDE mock: window rises, code types in line by line, agent
        // cards pop, sample tests tick in, token chip pulses.
        const tl = gsap.timeline({ delay: 0.35, defaults: { ease: "power3.out" } });
        tl.from(".gs-hero-visual", { y: 70, scale: 0.96, autoAlpha: 0, duration: 1.0 })
          .from(".gs-code-line", { autoAlpha: 0, x: -14, duration: 0.35, stagger: 0.14 }, "-=0.45")
          .from(".gs-agent-card", { autoAlpha: 0, y: 16, duration: 0.5, stagger: 0.28 }, "-=0.2")
          .from(".gs-test-row", { autoAlpha: 0, x: -10, duration: 0.4, stagger: 0.16 }, "-=0.15")
          .from(".gs-token-chip", { scale: 0.8, autoAlpha: 0, duration: 0.45, ease: "back.out(2.2)" }, "-=0.1");

        // Gentle parallax on the hero visual as the page scrolls away
        gsap.to(".gs-hero-visual", {
          yPercent: -4, ease: "none",
          scrollTrigger: { trigger: ".gs-hero-visual", start: "top top", end: "bottom top", scrub: true },
        });

        // Section reveals
        gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
          gsap.from(el, {
            y: 38, autoAlpha: 0, duration: 0.85, ease: "power3.out",
            scrollTrigger: { trigger: el, start: "top 86%", once: true },
          });
        });

        // Report bars grow on scroll into view
        gsap.utils.toArray<HTMLElement>(".gs-bar").forEach((el) => {
          gsap.from(el, {
            scaleX: 0, transformOrigin: "left center", duration: 1.0, ease: "power2.out",
            scrollTrigger: { trigger: el, start: "top 88%", once: true },
          });
        });

        // Count-ups (Fit %, prompt totals, token counts…)
        gsap.utils.toArray<HTMLElement>("[data-count]").forEach((el) => {
          const target = parseFloat(el.dataset.count || "0");
          const obj = { v: 0 };
          gsap.to(obj, {
            v: target, duration: 1.4, ease: "power2.out",
            scrollTrigger: { trigger: el, start: "top 90%", once: true },
            onUpdate: () => { el.textContent = String(Math.round(obj.v)); },
          });
        });

        // Magnetic CTAs (fine pointers only)
        if (window.matchMedia("(pointer: fine)").matches) {
          document.querySelectorAll<HTMLElement>("[data-magnetic]").forEach((el) => {
            const move = (e: MouseEvent) => {
              const r = el.getBoundingClientRect();
              gsap.to(el, {
                x: (e.clientX - r.left - r.width / 2) * 0.18,
                y: (e.clientY - r.top - r.height / 2) * 0.28,
                duration: 0.4, ease: "power2.out",
              });
            };
            const leave = () => gsap.to(el, { x: 0, y: 0, duration: 0.5, ease: "elastic.out(1, 0.45)" });
            el.addEventListener("mousemove", move);
            el.addEventListener("mouseleave", leave);
          });
        }

        // Card hover tilt (subtle, fine pointers only)
        if (window.matchMedia("(pointer: fine)").matches) {
          document.querySelectorAll<HTMLElement>("[data-tilt]").forEach((el) => {
            const move = (e: MouseEvent) => {
              const r = el.getBoundingClientRect();
              const rx = ((e.clientY - r.top) / r.height - 0.5) * -4;
              const ry = ((e.clientX - r.left) / r.width - 0.5) * 4;
              gsap.to(el, { rotateX: rx, rotateY: ry, transformPerspective: 900, duration: 0.4, ease: "power2.out" });
            };
            const leave = () => gsap.to(el, { rotateX: 0, rotateY: 0, duration: 0.5, ease: "power2.out" });
            el.addEventListener("mousemove", move);
            el.addEventListener("mouseleave", leave);
          });
        }
      });
    })();

    return () => {
      cancelled = true;
      ctx?.revert();
    };
  }, []);

  return null;
}
