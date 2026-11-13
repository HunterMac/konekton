## Snapping feature

I want to be able to see snapping lines and use snapping to other elements while moving objects.
My idea is to snap:
moved objects top, bottom, left right

to other objects top, bottom, left right


How does it work in Miro?

## Miro snapping

Miro's help center could not be fetched (HTTP 403), so this section is a rough description. Items marked **[source]** come from Miro community posts. Items marked **[observed]** are from general knowledge of how Miro behaves and should be checked in the live app before we copy exact numbers.

### Two separate systems

1. **Snap to objects** (alignment guides). A board setting called "Snap Objects" **[source]**. While you drag an object near other objects, guide lines appear and the object jumps onto the line.
2. **Snap to grid.** Only active when the grid is shown. Independent of object snapping **[observed]**.

### Object snapping rules

- **What snaps:** the dragged object's edges and its center lines (left / center / right on the X axis, top / middle / bottom on the Y axis) against the same three lines of other objects **[observed]**. Konekton's idea (edges only) is a subset of this.
- **Axes are independent:** X and Y snap separately. An object can snap on X only, Y only, or both **[observed]**.
- **Threshold:** a few screen pixels, not board units, so the pull feels the same at any zoom level **[observed]**. Exact value unknown; about 5-8 px is typical.
- **Guide line:** appears while a snap is active. It runs along the matched line and is drawn across the dragged object and the object(s) it matches. It disappears on mouse up **[observed]**.
- **Multiple matches:** several guides can show at once (for example left edge and top edge) **[observed]**. When two candidates are within the threshold on the same axis, the closest one wins **[observed]**.
- **Which objects count:** only objects near the dragged object, not the whole board **[observed]**. The dragged object is never matched with itself. Selected objects that are moving together are not matched either.
- **Multi-select:** the selection moves as one box. The box edges and center are what snap **[observed]**.
- **Override:** holding Ctrl (Cmd on Mac) turns snapping off while dragging **[source]**.
- **Setting:** snapping is on by default. It can be turned off in the board settings **[source]**.

### Sources

- [Miro community: Align Grid assistance](https://community.miro.com/ask-the-community-45/align-grid-assistance-4378)
- [Miro help: Structuring board content](https://help.miro.com/hc/articles/360017730973-Structuring-Board-Content) (not readable by the tool)

### Open checks in the live Miro app

1. Exact snap distance in pixels, and whether it scales with zoom.
2. Guide color and style.
3. Whether centers snap, or only edges.
4. Whether edge-to-opposite-edge snaps (left of A to right of B), or only same-side matches.


## Questions

Scope as given: Miro-style snapping, magenta guide lines, only the top, bottom, left and right edges, only while moving objects with the mouse. No settings, no other features. The only shortcut is Ctrl/Cmd to override snapping.

**Assumptions (tell me if one is wrong)**

- The moved object's left and right edges are compared with every other object's left and right edges. Top and bottom work the same way on the Y axis. So left-to-right (objects touching side by side) also snaps, not just left-to-left.
- X and Y snap independently.
- Snapping is always on. There is no setting. Holding Ctrl (Cmd on Mac) while dragging turns object snapping off, as in Miro. The key is checked on every drag move, so pressing or releasing it in the middle of a drag takes effect at once and the guides disappear. Ctrl/Cmd turns off object snapping only. Existing grid snapping keeps working as it does today.
- Guides are 1 px wide on screen at any zoom, solid, `#FF00FF`. They show only while a snap is active and disappear on mouse up.
- Snap distance is 12 screen pixels, so it feels the same at any zoom.
- Other objects that are being moved together (the selection) are not snap targets. Objects hidden from the board (`group` nodes) are not targets either.
- With several objects selected, the edges of the selection's bounding box snap.
- Only dragging with the mouse snaps. Paste, duplicate, drop from the Explorer, creating from the toolbar, resizing and moving line end points do not.
- A snapped object stays snapped until the pointer is more than 12 px away from the snap position, then it moves freely again.

Accepted
**Questions**

1. **Grid and object snapping together.** When the grid is on, an object can match both a grid line and another object's edge. Which should win?
   - A (recommended): object edges win on any axis where one is in range. The grid is used only on an axis with no object match.
   - B: grid always wins, object guides only show when the grid is off.
A)
2. **Guide length.** How far does a guide line reach?
   - A (recommended): Miro style. From the dragged object to the matched object (and any other matched object on the same line), with a small overhang.
   - B: one line across the whole visible board.
A)
3. **Several matches on one line.** If three objects share the matched edge position, draw the guide through all of them (part of A above), or only to the nearest one?
all of them

4. **Snap distance.** Is 6 screen pixels fine, or do you want it larger or smaller?
as on miro

## Konekton snapping implementation

### 1. Rules (final)

- **When:** only while objects are dragged with the mouse (a single object or a multi-selection). Nothing else snaps to objects: resize, create, paste, duplicate, Explorer drop and line end points stay as they are.
- **What:** the moving box is the dragged object, or the bounding box of all dragged objects. On the X axis, its left and right edges are compared with the left and right edges of every target (any pair: left-left, left-right, right-left, right-right). On the Y axis, the same with top and bottom. No centers.
- **Targets:** all shown objects (`boardNodes`) that are not being dragged and that are at least partly inside the visible board area. Hidden nodes (`group`) are never targets.
- **Distance:** `SNAP_PX = 12` screen pixels, converted to board units with `SNAP_PX / zoom`. Miro's exact value is unknown. Tune the constant by hand against Miro if it feels different.
- **Axes are independent.** Per axis, the pair with the smallest distance within `SNAP_PX` wins and the whole selection is shifted by that distance. Equal distances: the first pair found wins.
- **Staying snapped:** snapping is computed from the raw (unsnapped) drag position on every move. So the object stays on the line while the pointer is within `SNAP_PX` of it, and moves freely after that. No extra state is needed.
- **Grid:** when the grid is on, object snapping wins on an axis that has an object match. An axis without an object match snaps to the grid as today.
- **Ctrl/Cmd override:** while Ctrl or Cmd (`ctrlKey || metaKey`) is held, object snapping is off and no guides show. Grid snapping still applies. Pressing or releasing the key during a drag updates the position and guides at once, without a mouse move. Ctrl+click opens the context menu on Mac, so Mac users hold Cmd. Both keys work on every platform.
- **Guides:** magenta `#FF00FF`, solid, 1 screen px at any zoom. One guide per matched line. Each guide runs along the line from the outermost to the innermost object on it: the moving box plus every target that has an edge exactly on that line, not only the nearest. It extends `GUIDE_OVERHANG_PX = 8` screen px past both ends. Both edges on an axis can match at once (two guides), and X and Y guides can show together. Guides show only while a snap is active and are removed when the drag ends.

### 2. Why grid snapping moves out of React Flow

Today `<ReactFlow snapToGrid={gridEnabled}>` snaps drags. With `snapToGrid` on, React Flow only fires a drag update when the grid-snapped pointer changes (`XYDrag` compares `xSnapped`/`ySnapped`), so it fires once every 20 board units. Object snapping between grid steps would never run. It also hands over positions that are already grid-snapped, so the raw position is lost.

Change: set `snapToGrid={false}` always (keep `snapGrid` out too) and do grid snapping ourselves:

- **Drag:** in the snapping function (3.2), per axis, as the fallback when there is no object match. Like React Flow today, the grid snaps the first dragged node (the first entry of the position changes, which is React Flow's reference drag item), and the others keep their offsets.
- **Resize:** `resizeNode` in `store.ts` rounds width and height to `GRID_STEP` when the grid is on, with the same formula `finishResize` already uses (`Math.max(MIN_SIZE, snap(v, GRID_STEP))`, square for stickies). This replaces the pointer snapping React Flow's resizer did (M0 spike d). Resizing happens only from the bottom-right corner, so the result is the same for objects on the grid.

Object creation already snaps itself (`buildNode`), so it is not affected.

### 3. Code

#### 3.1 Files

| File | Change |
|---|---|
| `webview/src/snapping.ts` | New. Pure functions, no React. |
| `webview/src/ui/SnapGuides.tsx` | New. Draws the guides. |
| `webview/src/store.ts` | `snapGuides` UI state + `setSnapGuides`. Grid rounding in `resizeNode`. |
| `webview/src/App.tsx` | Snap position changes in `onNodesChange`, Ctrl/Cmd tracking, `snapToGrid={false}`, render `<SnapGuides />`. |
| `webview/src/styles.css` | `.eb-snap-guides` style. |
| `test/unit/snapping.test.ts` | New. |

#### 3.2 `snapping.ts`

```ts
export const SNAP_PX = 12;
export const GUIDE_OVERHANG_PX = 8;
export const GUIDE_COLOR = '#FF00FF';

// `Rect`, `boundsOf` and `snap` come from geometry.ts.

/** A guide line in board coordinates. `axis: 'x'` is a vertical line at x = `at`. */
export interface SnapGuide { axis: 'x' | 'y'; at: number; from: number; to: number }

export interface SnapInput {
  box: Rect;            // bounding box of the dragged objects at the raw position
  ref: { x: number; y: number }; // raw position of the first dragged node (grid reference)
  targets: Rect[];
  zoom: number;
  objects: boolean;     // false while Ctrl/Cmd is held
  gridStep?: number;    // set when the grid is on
}

export interface SnapResult { dx: number; dy: number; guides: SnapGuide[] }

export function snapMove(input: SnapInput): SnapResult;
```

`snapMove`, per axis (X shown; Y is the same with `y`/`height`):

1. If `objects` is true: moving edges `[box.x, box.x + box.width]`, target edges `[t.x, t.x + t.width]` for each target. Find the pair with the smallest `|target − moving|` that is `≤ SNAP_PX / zoom`. If found, `dx = target − moving`.
2. If no object match and `gridStep` is set: `dx = snap(ref.x, gridStep) − ref.x` (`snap` from `geometry.ts`).
3. Otherwise `dx = 0`.

Guides (only for an axis that matched an object): shift the box by `dx`/`dy`. For each of its two edges on that axis, collect the targets with an edge within `EPS = 0.01` of it. No targets: no guide for that edge. Otherwise one guide at that position; `from`/`to` are the min/max of the box and those targets on the other axis, minus/plus `GUIDE_OVERHANG_PX / zoom`.

Also add `intersects(a, b)` for the visible-area filter. Use `boundsOf` from `geometry.ts` for the moving box.

#### 3.3 Store

```ts
snapGuides: SnapGuide[];            // UI only, never saved
setSnapGuides(guides: SnapGuide[]): void;
```

`setSnapGuides` skips `set` when both lists are empty, so normal drags do not re-render for nothing.

#### 3.4 `App.tsx`

**Modifier tracking.** A ref `snapOff = useRef(false)`.
- In the existing board `onPointerMove`: `snapOff.current = e.ctrlKey || e.metaKey`. `pointermove` fires before the `mousemove` that React Flow's drag uses, so the value is current when `onNodesChange` runs.
- A `window` `keydown`/`keyup` listener for `Control` and `Meta`: update `snapOff.current`, and if a drag is active, re-run the snap with the last raw moves (below) and apply it. Remove the listener on unmount.

**Drag session.** A ref `drag = useRef<{ ids: Set<string>; raw: Move[] } | null>(null)`.

In `onNodesChange`, collect `position` changes as today, then:

1. If any change has `dragging === true`, or `drag.current` is set: this is a drag. Store `raw = moves` in `drag.current` (create it with the moved ids on the first change).
2. Run `applySnap(raw)`:
   - `box` = bounds of the moved nodes (size from `doc` by id, position from `raw`).
   - `ref` = `raw[0]`.
   - `targets` = `boardNodes(doc)` not in `ids`, filtered to those intersecting the visible area. Visible area: the board root's `getBoundingClientRect()` corners through `rf.screenToFlowPosition`.
   - `zoom` = `rf.getViewport().zoom`; `objects` = `!snapOff.current`; `gridStep` = `GRID_STEP` when the grid is on.
   - `api.moveNodes(raw shifted by dx, dy)` and `api.setSnapGuides(guides)`.
3. If the batch has a change with `dragging === false` (React Flow sends it at drag end, right before `onNodeDragStop`/`onSelectionDragStop`): apply the snap as in step 2 (that change carries the raw position again), then `setSnapGuides([])` and `drag.current = null`.
4. Position changes outside a drag (none today) go to `moveNodes` unchanged.

`onNodeDragStop`/`onSelectionDragStop` keep calling `commit`, so one drag is still one undo step and the saved position is the snapped one.

Remove `snapToGrid={gridEnabled}` and `snapGrid` from `<ReactFlow>`, add `snapToGrid={false}` only if needed for clarity. Render `<SnapGuides />` as a child of `<ReactFlow>`.

#### 3.5 `SnapGuides.tsx`

- Reads `snapGuides` from the store. Returns `null` when empty.
- Renders inside `ViewportPortal` (board coordinates, drawn above the objects like the line dots and toolbars).
- One `<svg className="eb-snap-guides">` at `left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none`.
- One `<line>` per guide: vertical for `axis: 'x'` (`x1 = x2 = at`, `y1 = from`, `y2 = to`), horizontal for `axis: 'y'`. `stroke={GUIDE_COLOR}`, `strokeWidth={1}`, `vectorEffect="non-scaling-stroke"` for a constant 1 screen px, `shapeRendering="crispEdges"`.

### 4. Tests

**Unit (`test/unit/snapping.test.ts`)**

- Left-left, left-right, right-left, right-right each snap on X. Top/bottom pairs snap on Y.
- Distance just inside and just outside `SNAP_PX / zoom`, at zoom 0.5, 1 and 2.
- Closest pair wins when two targets are in range on one axis.
- X and Y snap independently: only X, only Y, both.
- `objects: false`: no object snap, no guides, grid still applies.
- Grid on: object match wins on its axis, grid used on the other axis. Grid off and no match: `dx = dy = 0`.
- Guide extent: covers the box and all targets on the line (three objects on one line → one guide through all), plus the overhang.
- Two guides when both edges of an axis match.
- Multi-selection: the bounding box snaps, `ref` drives the grid.

**Manual (add to the README checklist)**

- Drag a sticky next to a rectangle: magenta guides appear at aligned edges, the sticky jumps into place, guides go away on release.
- Same at 25% and 300% zoom: the pull distance and guide width look the same on screen.
- Hold Ctrl (Cmd on Mac) mid-drag: guides go away, the object follows the pointer. Release: it snaps again without moving the mouse.
- Grid on: objects still snap to edges of off-grid objects, and to the grid otherwise. Resize still snaps to the grid.
- One undo after a snapped drag returns the object to where it started.
- Objects outside the visible area are never snapped to.

### 5. Out of scope

Center lines, equal-spacing guides, snapping during resize or line end-point moves, snapping for keyboard moves, a setting to turn snapping off, and any other shortcut.