import type { Transition } from "framer-motion";

/**
 * Motion tokens for TT SlideViewer.
 *
 * easyui is spring-driven; these tokens keep the library's feel with damping
 * close to critical, so feedback is silky and natural without cartoon bounce.
 * Pure eases are reserved for opacity/color-only changes.
 */
const spring = (stiffness: number, damping: number, mass = 0.8): Transition => ({
  type: "spring",
  stiffness,
  damping,
  mass,
});

export const motionTransitions = {
  /** large surfaces: dialogs, panels */
  springGentle: spring(240, 26),
  /** standard element motion */
  springSmooth: spring(300, 30),
  /** buttons, toggles, chips — immediate but soft landing */
  springSnappy: spring(500, 32, 0.6),
  /** dialog morph / layout transitions */
  springMorph: spring(230, 26),
  /** hover popovers, tooltips */
  springResponsive: spring(480, 30, 0.6),
  /** slow settle for big overlays */
  springSoft: spring(180, 22),
  /** opacity/xy micro shifts */
  easeSoft: { duration: 0.16, ease: [0.16, 0.84, 0.44, 1] } as Transition,
  easeFast: { duration: 0.1, ease: [0.16, 0.84, 0.44, 1] } as Transition,
};

export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: motionTransitions.easeSoft,
};
