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
    image: "/images/01_mansion.jpg",
    alt: "A white classical villa with arched black-framed windows at sunset, a circular driveway in front",
    title: "From one drawing, a whole house",
    caption: "Every wall you see started as a line on a plan.",
  },
  {
    id: "lobby",
    image: "/images/02_lobby.jpg",
    alt: "A double-height lobby with a curved marble staircase and wrought-iron railings",
    title: "The lobby",
    caption: "Walk through it at eye height, or orbit it from above.",
  },
  {
    id: "living",
    image: "/images/03_living_room.jpg",
    alt: "A living room with fluted columns, a coffered ceiling and white modular sofas",
    title: "The living room",
    caption: "Move a wall and the room, its area and its drawings follow.",
  },
  {
    id: "dining",
    image: "/images/04_dining_room.jpg",
    alt: "A long candlelit dining table beneath tall arched windows and a stone fireplace",
    title: "The dining room",
    caption: "Furnish it from a catalog of lights, furniture and finishes.",
  },
  {
    id: "piano",
    image: "/images/05_piano_room.jpg",
    alt: "A round music room with a grand piano beneath a crystal chandelier and a carved dome",
    title: "Now, build yours",
    caption: "Upload a blueprint to begin.",
  },
];
