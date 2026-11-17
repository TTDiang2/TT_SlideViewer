import { getCurrentWindow } from "@tauri-apps/api/window";

type Dir = "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West";

const DIRS: Array<[string, Dir]> = [
  ["n", "North"],
  ["s", "South"],
  ["e", "East"],
  ["w", "West"],
  ["ne", "NorthEast"],
  ["nw", "NorthWest"],
  ["se", "SouthEast"],
  ["sw", "SouthWest"],
];

/**
 * With `decorations: false` the native resize border disappears, so the app
 * implements all eight hotzones itself. Hidden while maximized.
 */
export function ResizeHandles({ disabled }: { disabled: boolean }) {
  if (disabled) return null;
  const win = getCurrentWindow();
  return (
    <>
      {DIRS.map(([cls, dir]) => (
        <div
          key={cls}
          className={`rz rz-${cls}`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            void win.startResizeDragging(dir);
          }}
        />
      ))}
    </>
  );
}
