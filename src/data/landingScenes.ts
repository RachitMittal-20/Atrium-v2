/*
 * src/data/landingScenes.ts
 *
 * The photographed part of the landing story, in scroll order. LandingTour
 * renders one full-screen layer per entry and reveals each through an
 * arch-shaped opening. Text lives here, not in the component, so copy
 * changes never touch animation code.
 */
export interface LandingScene {
  id: string;
  image: string; // path under /public
  alt: string;   // accessible description of the photo
  title: string; // large display line
  caption: string; // one short supporting sentence
}

export const LANDING_SCENES: LandingScene[] = [
  {
    id: "mansion",
    image: "/images/01_mansion.webp",
    alt: "A white classical villa with arched black-framed windows at sunset, a circular driveway in front",
    // The page's one "From one drawing, a whole house" is the blueprint scene's h1 (step L.2); this scene has its own line.
    title: "Every wall starts as a line on a plan",
    caption: "Atrium turns the lines of a plan into walls, doors and windows you can walk through.",
  },
  {
    id: "lobby",
    image: "/images/02_lobby.webp",
    alt: "A double-height lobby with a curved marble staircase and wrought-iron railings",
    title: "The lobby",
    caption: "Walk through it at eye height, or orbit it from above.",
  },
  {
    id: "living",
    image: "/images/03_living_room.webp",
    alt: "A living room with fluted columns, a coffered ceiling and white modular sofas",
    title: "The living room",
    caption: "Move a wall and the room's area follows.",
  },
  {
    id: "dining",
    image: "/images/04_dining_room.webp",
    alt: "A long candlelit dining table beneath tall arched windows and a stone fireplace",
    title: "The dining room",
    caption: "Measure it, check it against the drawing, and take its areas off.",
  },
  {
    id: "piano",
    image: "/images/05_piano_room.webp",
    alt: "A round music room with a grand piano beneath a crystal chandelier and a carved dome",
    title: "Now, build yours",
    caption: "Upload a blueprint to begin.",
  },
];
