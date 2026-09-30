/**
 * src/types/blueprint.ts
 *
 * Shared types for the "Blueprint to 3D" pipeline — the code that turns a
 * flat 2D floor-plan image into a 3D model the rest of the app treats
 * like any other uploaded .glb. Every stage lives in src/lib/blueprint/
 * and hands its result to the next stage using exactly these shapes, so
 * they are declared once here (this codebase's rule: shared types live
 * in src/types and are imported, never redeclared) instead of inside the
 * stage that happens to produce them.
 *
 * The pipeline, in order, and which type each hand-off carries:
 *   image pixels (PlanPixels)
 *     -> deskew         (lib/blueprint/deskew.ts)     -> PlanPixels, straightened
 *     -> detectWalls    (lib/blueprint/hollowWalls.ts) -> WallMask; picks per image
 *        between extractWalls (lib/blueprint/wallMask.ts) as-is, for solid
 *        walls, and extractWalls after fillHollowWalls, for walls drawn as
 *        two thin parallel lines
 *     -> vectorize      (lib/blueprint/vectorize.ts)  -> PixelWall[]
 *     -> detectOpenings (lib/blueprint/openings.ts)   -> OpeningCandidate[], from
 *        the walls and the deskewed but unfilled image
 *     -> estimateScale  (lib/blueprint/scale.ts)      -> pixels per metre, from
 *        the OcrWord[] that lib/blueprint/ocr.ts reads off the straightened image
 *     -> buildPlan      (lib/blueprint/toPlan.ts)     -> an editable Plan in metres
 *        (types/plan.ts) plus a BuildReport, from BuildInput and a PlanScale
 *     -> detectRooms   (lib/blueprint/rooms.ts)      -> RoomMap
 *     -> buildPlanModel (lib/blueprint/buildModel.ts) -> a three.js scene
 *     -> exported to a .glb File by lib/blueprintToModel.ts, which the
 *        landing screen (Invitation.tsx) feeds into the existing
 *        "Try your own model" upload path.
 *
 * All pixel arrays are row-major (index = y * width + x), with y growing
 * downward exactly like the source image — the 3D builder is the one
 * place that turns image y into world z.
 */
import type { Vec2 } from "./plan";

/** Raw pixels as a canvas's getImageData delivers them (RGBA, 4 bytes per
 *  pixel). Kept as a plain interface, not ImageData, so the pipeline's
 *  pure functions run identically in the browser and under Node in tests. */
export interface PlanPixels {
  width: number;
  height: number;
  rgba: Uint8ClampedArray | Uint8Array;
}

/** What extractWalls found: a same-size binary mask (1 = wall, 0 = not),
 *  plus the measurements the later stages scale their own thresholds by,
 *  so nothing downstream hard-codes a pixel size that only fits one image. */
export interface WallMask {
  width: number;
  height: number;
  /** 1 where a pixel belongs to a wall, 0 everywhere else. */
  mask: Uint8Array;
  /** The dominant wall thickness in pixels (the exterior walls, typically). */
  wallThickness: number;
  /** Wall-mask pixels / dark pixels in the source (0–1): how much of the
   *  drawing's ink the mask kept. `coverage` in vectorize.ts only says how well
   *  the walls explain the mask, so a mask that missed the walls still scores
   *  high there; this is the number that drops. Reported only, nothing gates on it yet.
   *  In hollow mode (hollowWalls.ts) the mask comes from a filled image, so to
   *  stay comparable this is instead the share of the ORIGINAL dark pixels on
   *  or within one wall thickness of a found wall centre line. */
  inkCapture: number;
  /** Hollow mode only: wall-mask pixels / dark pixels of the FILLED image, the
   *  number `inkCapture` would have held. Absent in solid mode. */
  fillCapture?: number;
}

/** One detected room: an id that is also its label value in RoomMap.labels. */
export interface PixelRoom {
  /** 1-based; 0 in RoomMap.labels means "not part of any room" (a wall or
   *  the outside). */
  id: number;
  /** Number of pixels the room covers — used to name/sort rooms and to
   *  drop slivers. */
  area: number;
  /** Bounding box in pixels, inclusive-exclusive: [x0, y0, x1, y1). */
  bbox: [number, number, number, number];
}

/** What detectRooms found: a per-pixel room label and one PixelRoom per label. */
export interface RoomMap {
  width: number;
  height: number;
  /** labels[y * width + x] = a PixelRoom.id, or 0 for wall/outside. */
  labels: Int32Array;
  rooms: PixelRoom[];
}

/** A plain axis-aligned rectangle in pixels, [x0, y0, x1, y1) — what walls
 *  and floors are decomposed into before being extruded into boxes. */
export interface PixelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One word as OCR read it (lib/blueprint/ocr.ts), with its box in the pixel
 *  space of the image that was read (the deskewed, unfilled plan). scale.ts
 *  groups these into lines and looks for printed dimensions in them. */
export interface OcrWord {
  text: string;
  box: PixelRect;
  /** Tesseract's confidence, 0–100. */
  confidence: number;
  /** True when the word was read from the 90°-rotated copy: text that runs
   *  bottom to top on the plan, so the box is taller than it is wide. */
  vertical?: boolean;
}

/** Thrown for problems a person can act on (an image with no solid walls,
 *  no rooms found, ...). The dialog shows `message` as-is, so it is
 *  written for the user, not for a developer. A class rather than a
 *  string so callers can tell "user-fixable" from "a genuine bug" with
 *  `instanceof` — the one runtime value this types file exports, the same
 *  small exception project.ts's ELEMENT_CATEGORIES already makes. */
export class BlueprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlueprintError";
  }
}

/** An axis-aligned rectangle on the floor in metres: x to the right, z
 *  "down the plan" (image y). [x0, x1) by [z0, z1). */
export interface MetreRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** One room in a layout: a name, a floor colour, and the rectangles that
 *  make up its floor (an L-shaped room is two or more). */
export interface PlanRoom {
  name: string;
  /** CSS hex colour, e.g. "#d8c3a5". */
  color: string;
  rects: MetreRect[];
}

/** Everything the 3D builder needs, in metres. Both ways of making a
 *  model — reading an image, or filling in the manual form — end up as
 *  one of these, so there is exactly one place that makes geometry. */
export interface PlanLayout {
  wallHeight: number;
  /** Wall thickness in metres when every wall shares one (the manual
   *  form); room rectangles then run to wall centre-lines and furniture
   *  is inset by half of it. Omitted for image plans, whose room
   *  rectangles already stop at the wall's inner face. */
  wallThickness?: number;
  /** Solid wall pieces, standing from the floor up to wallHeight. */
  walls: MetreRect[];
  rooms: PlanRoom[];
  /** Visible door leaves, shown standing open in the opening. Only the
   *  manual form knows exactly where its doors are; an image-derived plan
   *  has no entry here and its doorways stay open gaps. */
  doors?: PlanDoor[];
}

/** One door leaf: a panel `width` metres wide standing `height` tall,
 *  hinged at (hingeX, hingeZ) and swung open along (swingX, swingZ) — a
 *  unit vector, always axis-aligned, pointing from the hinge into the
 *  room the door opens into. */
export interface PlanDoor {
  name: string;
  hingeX: number;
  hingeZ: number;
  width: number;
  height: number;
  swingX: number;
  swingZ: number;
}

export type ManualPlacement = "right" | "below" | "custom";
export type ManualDoorSide = "none" | "north" | "east" | "south" | "west";

/** One room as typed into the manual form. */
export interface ManualRoomSpec {
  name: string;
  /** East-west size in metres. */
  width: number;
  /** North-south size in metres. */
  depth: number;
  /** "right"/"below": snap to the previous room's east/south edge;
   *  "custom": use x and z below. The first room always sits at 0,0. */
  placement: ManualPlacement;
  x: number;
  z: number;
  /** Which side of this room gets a doorway (0.9 m, centred). */
  door: ManualDoorSide;
}

export interface ManualPlanSpec {
  wallHeight: number;
  /** Wall thickness in metres. */
  wallThickness: number;
  rooms: ManualRoomSpec[];
}

/** What a room is used for — decides which furniture goes in it. */
export type RoomKind = "bedroom" | "living" | "kitchen" | "bathroom" | "dining" | "study" | "other";

/** One axis-aligned box of a furniture piece, in metres, with its own
 *  colour so a piece can be multi-toned inside a single mesh. */
export interface FurnitureBox {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** CSS hex colour. */
  color: string;
}

/** A placed piece of furniture, already in plan coordinates (metres). */
export interface FurnitureItem {
  /** Unique display name, e.g. "Bedroom Bed". */
  name: string;
  /** Category stored on the exported mesh. */
  category: "Furniture" | "Fixture";
  boxes: FurnitureBox[];
}

/** One wall centre line found by vectorize.ts, in PIXELS (image x right,
 *  image y down). `thickness` is the wall's width across the line, also in
 *  pixels. Scale to metres is applied later (lib/blueprint/scale.ts). */
export interface PixelWall {
  a: { x: number; y: number };
  b: { x: number; y: number };
  thickness: number;
}

/** One gap in a wall line found by lib/blueprint/openings.ts, in deskewed
 *  PIXELS like PixelWall. The scale is not known yet at this stage; the
 *  conversion to metres (and door versus passage by width) comes later. */
export interface OpeningCandidate {
  /** The two ends of the gap: the facing wall ends. */
  a: Vec2;
  b: Vec2;
  centre: Vec2;
  /** |b - a|. Includes the jamb absorption described in openings.ts. */
  widthPx: number;
  wallThicknessPx: number;
  kind: "window" | "door";
  evidence: {
    /** A thin dark line runs along at least 80% of the gap inside the wall band. */
    glazingLine: boolean;
  };
}

/** Pixels per metre and where that number came from (scale.ts found it on
 *  the plan, the user typed a length, or a unit-less size label was read
 *  as feet or metres). */
export interface PlanScale {
  pxPerM: number;
  source: "ocr" | "manual" | "unitless-feet" | "unitless-metres";
}

/** What lib/blueprint/toPlan.ts `buildPlan` turns into a Plan, all in
 *  deskewed PIXELS. Wall ids default to "p1", "p2", ... in array (vectorize)
 *  order; the review screen refers to walls by these ids. */
export interface BuildInput {
  walls: (PixelWall & { id?: string })[];
  openings: OpeningCandidate[];
  /** detectOpenings' unpaired free ends. buildPlan recomputes free ends from
   *  the finished walls (report.freeEnds), which include these. */
  unpaired: Vec2[];
  imageSize: { width: number; height: number };
  name: string;
}

/** Everything buildPlan changed, kept apart or could not place, so nothing is
 *  lost silently. Pixel positions are deskewed-image pixels; metre positions
 *  are plan coordinates (px = origin + m × pxPerM). */
export interface BuildReport {
  scale: PlanScale;
  /** Pixel position of plan (0, 0). */
  origin: Vec2;
  /** Openings over 2.4 m up to 4 m wide: kept with their detected kind (a
   *  passage stays a door) and flagged. */
  wideOpenings: { openingId: string; kind: OpeningCandidate["kind"]; widthM: number }[];
  /** Gaps over 4 m wide: not bridged, so their two wall ends stay free. */
  droppedPairs: { a: Vec2; b: Vec2; widthM: number }[];
  /** Gaps that could not be bridged because no wall ends at one side (for
   *  example it was removed); their remaining wall ends stay free. */
  unbridged: { a: Vec2; b: Vec2; reason: string }[];
  /** Merged pieces whose thickness differed by more than 30%, and thicknesses
   *  clamped to 0.05–0.6 m. */
  thickness: string[];
  /** Openings moved or narrowed by more than 1 cm to fit inside one wall. */
  adjusted: string[];
  /** Wall ends, in metres, that no other wall shares. */
  freeEnds: Vec2[];
  /** validatePlan(plan). */
  problems: string[];
}
