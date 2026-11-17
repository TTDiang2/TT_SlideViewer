export type Tool = "pan" | "measure" | "rect" | "arrow" | "freehand" | "text";

export interface Pt {
  x: number;
  y: number;
}

export interface Annotation {
  id: string;
  type: "rect" | "arrow" | "freehand" | "text";
  points: Pt[];
  text?: string;
  color: string;
  slide: string;
  level: number;
}

export interface MeasureState {
  points: Pt[];
  done: boolean;
}
