## MORPHING BOARD

## FEATURES

3 views that can we switched with some moving nodes animation
- CHAOS (CREATE)
- BOARD (PLAN)
- TIMELINE (DO)

user can switch between them, but main orchestrator is CHAOS.

There is one chaos per file, but it can hold many boards and timelines.
Chaos allows marking it
Base for chaos is current main canvas board

## PHASE 1 SCOPE
3 views amnd switching between them
Marking

## DECISIONS

All Phase 1 questions are answered. The guide below follows these decisions.

| Topic | Decision |
|---|---|
| File format | The `.canvas` file is enough. Plans go in a top-level `konekton` key, and status and date go in each node's `konekton` field. Konekton already keeps unknown keys, so the data survives saves. Other canvas apps may drop it, which is acceptable. |
| Marking | A direct `Add to Board` / `Add to Timeline` action in Chaos. No "ready" gate. |
| What a plan shows | Only items added to it. Items are created only in Chaos. |
| Number of plans | One Board and one Timeline per file. The format stores a list, so Phase 2 can add more. |
| Board lanes | Fixed: `Todo`, `In progress`, `Done`. |
| Status and date | Both shared (one value everywhere). Changed by dragging cards in Board (status) and Timeline (date). Only metadata changes, never the item. |
| Timeline data | One date per item. |
| Timeline layout | A horizontal segmented arrow. The scale switches between Days, Weeks and Months. The default is Days. |
| Drop on week / month | Keep the date if it is already in that segment, otherwise set the first day of the segment (Monday, or the 1st). |
| Items with no date | An "Unscheduled" strip under the arrow. |
| Board vs Timeline | Separate selections. One item can be in both. |
| Editing in plan views | No text editing, no creating. Double-click jumps to the item in Chaos. `Remove from plan` is allowed. Delete only in Chaos. |
| Lines in plan views | Hidden. |
| Morph animation | Yes, about 300 ms. |
| Active view, scale, viewports | Kept in webview state, never in the file. |
| Done items in Chaos | Faded, with a small check mark. |
| Object kinds | All four: sticky, rectangle, file, link. |

## Phase 1 Implementation

### Goal

The three views work in one `.canvas` file. You can switch between them with a short morph animation. You can mark Chaos items into the Board and the Timeline, move cards between lanes and dates, and remove them again. Chaos stays the source of all items.

### Rules

1. Every item lives in Chaos. Nothing exists only in a plan.
2. Board and Timeline never change Chaos positions (`x`, `y`, `width`, `height`).
3. Board and Timeline change only metadata: status, date, card order and membership.
4. Removing an item from a plan removes it only from that plan. Deleting in Chaos deletes it everywhere.
5. One item can be in the Board and in the Timeline at the same time.
6. Status and date are shared. Card order is per plan.
7. Chaos never nags: no required fields and no warnings.
8. Switching views, changing the scale and panning never change the file and never add an undo step.
9. Every plan action (add, remove, status, date, reorder) is exactly one undo step.

### Architecture in one paragraph

There is still one React Flow instance and one zustand store. A new `mode` (`chaos | board | timeline`) decides where each node is drawn. In Chaos, positions come from the file, as today. In Board and Timeline, positions come from pure layout functions that read the doc and the plan. These positions are never stored. Nodes keep the same ids in every mode, so the switch can animate each node from its old position to its new one. Drags in plan views do not move nodes in the doc. On drop, a pure "drop target" function turns the pointer position into one store action (`setStatus`, `setDate`, `reorderInPlan`, …).

### Build order

Each step can be merged on its own and keeps the extension working.

1. File format (no UI)
2. Store: mode, plans, plan actions
3. Webview state per mode
4. Layout and drop functions (pure, with tests)
5. Plan rendering in `App.tsx` (cards, lanes, arrow)
6. Drag and drop in plan views
7. View switcher, toolbar and keyboard rules
8. Context menus
9. Chaos indicators
10. Morph animation
11. Docs and final checks

---

### Step 1. File format

File: `src/shared/canvasFormat.ts`. Tests: `test/unit/canvasFormat.test.ts`.

**Types**

```ts
export type Status = 'todo' | 'inProgress' | 'done';
export const STATUSES: readonly Status[] = ['todo', 'inProgress', 'done'];
export type PlanType = 'board' | 'timeline';

export interface Plan {
  id: string;
  type: PlanType;
  name: string;
  /** Node ids, in card order. For Board this is also the order inside each lane. */
  items: string[];
  /** Unknown keys of this plan, written back unchanged. */
  extra: Extra;
}

export interface CanvasDoc {
  nodes: AnyNode[];
  edges: (BoardEdge | UnsupportedEdge)[];
  /** Plans from the top-level `konekton` key. Empty when the file has none. */
  plans: Plan[];
  /** Entries of `konekton.plans` that are not valid plans, kept verbatim. */
  otherPlans: Json[];
  /** Unknown keys inside the top-level `konekton` key. */
  konektonExtra: Extra;
  extra: Extra;
}
```

Add to `NodeBase`:

```ts
  status?: Status;
  /** Local calendar date, `YYYY-MM-DD`. */
  date?: string;
```

**File shape**

```json
{
  "nodes": [
    { "id": "n1", "type": "text", "text": "Call plumber", "konekton": { "kind": "sticky", "status": "inProgress", "date": "2026-11-03" } }
  ],
  "edges": [],
  "konekton": {
    "version": 1,
    "plans": [
      { "id": "p1", "type": "board", "name": "Board", "items": ["n1"] },
      { "id": "p2", "type": "timeline", "name": "Timeline", "items": ["n1"] }
    ]
  }
}
```

**Parsing**

- Read the top-level `konekton` object: `version` (ignore unknown versions for now, but keep the key), `plans`, and keep everything else in `konektonExtra`. Remove `konekton` from `extra`.
- A top-level `konekton` that is not an object stays in `extra`. A `konekton.plans` that is not an array stays in `konektonExtra`. So a save does not lose them.
- A plan is valid when `id` is a string and `type` is `board` or `timeline`. Keep invalid entries verbatim in `otherPlans`, so plans of a future type survive a save. `name` defaults to `PLAN_NAMES` (`Board` / `Timeline`). `items` keeps only strings and drops duplicates.
- Do not drop ids of missing nodes in `parse`. Keep the doc faithful, and filter at read time (see Step 2). This keeps the round trip exact.
- Node `status`: valid only if it is in `STATUSES`. Node `date`: valid only if it matches `^\d{4}-\d{2}-\d{2}$` and is a real date. Invalid values are left in `elExtra` unchanged, so nothing is lost. When the user sets a valid value later, it replaces the invalid one on save.
- Add `status` and `date` to the known `konekton` keys of all four node kinds.

**Serializing**

- Write `konekton` on the top level only when `plans`, `otherPlans` or `konektonExtra` is not empty. Files without plans must serialize exactly as today.
- Key order: `nodes`, `edges`, `konekton`, then the other `extra` keys.
- `konekton.plans` holds the valid plans, then `otherPlans`. When there are plans, they replace a `plans` value of the wrong shape in `konektonExtra`, and our `konekton` object replaces a non-object one in `extra`.
- Node `status` and `date` are written inside the node's `konekton` field only when set. Link nodes write a `konekton` field today only when `elExtra` is not empty: also write it when `status` or `date` is set.

**Tests**

- `sample.canvas` and the other fixtures still round-trip to identical text.
- A new fixture `test/fixtures/plans.canvas` round-trips to identical text.
- Invalid plans are not in `plans`, but survive a save unchanged. So do a non-array `plans` and a non-object `konekton`. Plans with unknown keys keep them.
- Invalid `status` / `date` values survive a save unchanged. A valid value set later replaces them.
- A link node with only `status` writes a `konekton` field.

### Step 2. Store: mode, plans, plan actions

File: `webview/src/store.ts`. Tests: new `test/unit/plans.test.ts` for the pure helpers.

**Pure helpers** (new file `webview/src/plans.ts`, no React, easy to test):

```ts
export type Mode = 'chaos' | 'board' | 'timeline';

/** The Phase 1 plan of this type: the first one in the file, or a default that is not saved yet. */
export function planOf(doc: CanvasDoc, type: PlanType): Plan;
/** Plan items that point to visible nodes, in order. */
export function planNodes(doc: CanvasDoc, plan: Plan): BoardNode[];
/** Return the doc with `plan` stored: replaces the plan with the same id, or appends it. */
export function withPlan(doc: CanvasDoc, plan: Plan): CanvasDoc;
/** Remove node ids from every plan. */
export function withoutNodes(doc: CanvasDoc, ids: ReadonlySet<string>): CanvasDoc;
export function statusOf(n: BoardNode): Status; // missing = 'todo'
```

- The default plan has a fixed, recognizable id per type (for example `board-default`, `timeline-default`). It is not saved until the first plan action. So opening a file never changes it.

**State**

- `mode: Mode`, initialised from webview state (Step 3).

**Actions** (each one calls `apply(next)` once, so one commit and one undo step):

| Action | Effect |
|---|---|
| `setMode(mode)` | UI only. Clears selection, editing, context menu and snap guides. No commit. |
| `addToPlan(type, nodeIds)` | Append ids that are not in the plan yet. Store the plan with `withPlan`. |
| `removeFromPlan(type, nodeIds)` | Remove ids from that plan only. |
| `setStatus(nodeIds, status)` | Set `status` on the nodes. `todo` removes the key, so plain files stay clean. |
| `setDate(nodeIds, date \| undefined)` | Set or clear `date` on the nodes. |
| `moveCard(type, nodeId, { status?, date?, index })` | One drop in a plan view: status or date change plus the new position in `items`, in one commit. |

**Changes to existing actions**

- `deleteSelection`: also call `withoutNodes` with the deleted ids, in the same `apply`.
- `applyExternal`: no change needed. Plans with missing ids are filtered by `planNodes`.
- `duplicateSelection` and paste (`clipboard.ts`): copies get new ids, so they are not in any plan. Also strip `status` and `date` from copies. A copy is a new idea, not the same task.
- All actions that change content (`createNode`, `updateNode`, `pasteText`, `connect`, …) are allowed only in `chaos` mode. Guard them at the top with `if (get().mode !== 'chaos') return`.

### Step 3. Webview state per mode

File: `webview/src/vscodeApi.ts`, used in `App.tsx`.

```ts
export interface ViewState {
  mode?: Mode;
  viewports?: Partial<Record<Mode, { x: number; y: number; zoom: number }>>;
  timelineScale?: Scale;
}
```

- Replace `saveViewState(state)` with `updateViewState(patch)`. It reads the current state, merges the patch and saves. Today `persistViewport` writes `{ viewport }` and would wipe the other keys.
- Migrate the old `viewport` key to `viewports.chaos` when it is read.
- Each mode has its own viewport. When you switch mode, save the current viewport under the old mode and restore the new mode's viewport. If the new mode has none yet, use `fitView` over the cards.
- If you switch again while the camera animation of the last switch runs (Step 10), save the camera that animation moves to, not the in-between one. `onMoveEnd` saves nothing during that animation.
- `App.tsx` saves `mode` on every change, from the switcher, from `Show in Chaos` and from a double-click.

### Step 4. Layout and drop functions (pure)

New files: `webview/src/layout/boardLayout.ts`, `webview/src/layout/timelineLayout.ts`, `webview/src/layout/dates.ts`. Tests: `test/unit/boardLayout.test.ts`, `test/unit/timelineLayout.test.ts`, `test/unit/dates.test.ts`.

**Shared output**

```ts
export interface CardBox { id: string; x: number; y: number; width: number; height: number }
export interface Region { key: string; label: string; x: number; y: number; width: number; height: number; highlight?: boolean }
export interface PlanLayout { cards: CardBox[]; regions: Region[] }
```

- One card size for all kinds: `CARD = { width: 220, height: 96 }`, `GAP = 12`. Define these constants in one place.

**Board** (`boardLayout.ts`)

```ts
export function layoutBoard(nodes: BoardNode[]): PlanLayout;
export function boardDropTarget(layout: PlanLayout, nodes: BoardNode[], dragged: string, p: Point): { status: Status; index: number } | null;
```

- Three lanes side by side at `x = 0`, `LANE_WIDTH = CARD.width + 2 * GAP`, with a header row for the title. Lane height follows the longest lane, with a minimum height so an empty lane is still a drop target.
- Cards go into the lane of their status, in the order of `nodes` (which is the plan order).
- Drop target: the lane under `p.x`, and the index from `p.y` between the cards of that lane, ignoring the dragged card. Outside every lane: `null` (the card goes back).
- `index` is turned into a position in `plan.items` by the store: insert before the card that is at that index in the lane, or after the last card of the lane.

**Dates** (`dates.ts`)

Work with `YYYY-MM-DD` strings and local calendar math only. Never use `new Date('YYYY-MM-DD')`, because it parses as UTC and can shift the day.

```ts
export type Scale = 'days' | 'weeks' | 'months';
export function today(): string;                       // local date
export function addDays(date: string, n: number): string;
export function startOfWeek(date: string): string;     // Monday
export function startOfMonth(date: string): string;    // 1st
export function segmentIndex(date: string, origin: string, scale: Scale): number;
export function segmentStart(index: number, origin: string, scale: Scale): string;
export function segmentLabel(index: number, origin: string, scale: Scale): string;
export function dropDate(current: string | undefined, index: number, origin: string, scale: Scale): string;
```

- `origin` is the start of the segment that contains today, minus 3 segments. So the arrow starts a few segments before today.
- `dropDate`: if `current` is inside segment `index`, return `current`. Otherwise return `segmentStart(index)`. In Days this is always the dropped day.

**Timeline** (`timelineLayout.ts`)

```ts
export function layoutTimeline(nodes: BoardNode[], scale: Scale, todayDate: string, range: { from: number; to: number }): PlanLayout;
export function timelineDropTarget(layout: PlanLayout, p: Point): { kind: 'segment'; index: number } | { kind: 'unscheduled' } | null;
```

- The arrow is a horizontal row of segments at `y = 0`. `SEGMENT_WIDTH = CARD.width + 2 * GAP` for every scale. The segment with today has `highlight: true`.
- `range` is the visible segment range, computed in `App.tsx` from the viewport plus a margin. It also includes the segments that hold cards (`coverRange`), but grows past the visible range by at most `MAX_COVER_SEGMENTS` (600) segments in total. So the arrow grows as you pan, cards far in the past or future still show, and one date far away cannot build thousands of segments. Cards further away get their segments when you pan near them.
- In other modes `App.tsx` does not track the range, so panning there does not re-render.
- Cards with a date are stacked upwards above their segment (`y < 0`), in plan order.
- Cards with no date go into the "Unscheduled" region below the arrow, in plan order, wrapping into rows of 4. The cards start at segment 0, the left edge of the home view, so panning does not move them. The region spans the visible range and always covers them.
- Labels: Days `Mon 3 Nov`, Weeks `3–9 Nov`, Months `Nov 2026`. Use `Intl.DateTimeFormat` with the VS Code UI language. Build one formatter per option set and reuse it.
- `App.tsx` checks the date each minute and when the tab is shown again, so today moves on at midnight.

**Tests**

- Board: lane per status, order kept, missing status means `todo`, drop index at the top, middle, end and in an empty lane, drop outside means `null`.
- Dates: Monday start, month start, year change, leap day, a date before `origin` gives a negative index.
- `dropDate` keeps the date in the same week or month and moves to the first day otherwise.
- Timeline: cards in the right segment, the Unscheduled region at segment 0 for any visible range, the range includes the segments with cards, and `coverRange` stops at `MAX_COVER_SEGMENTS`.

### Step 5. Plan rendering in `App.tsx`

Files: `webview/src/App.tsx`, new `webview/src/nodes/CardNode.tsx`, new `webview/src/ui/PlanBackground.tsx`.

- The `nodes` memo branches on `mode`:
  - `chaos`: as today.
  - `board` / `timeline`: take `planNodes(doc, planOf(doc, type))`, run the layout and map each `CardBox` to a React Flow node with `type: 'card'`, the card position and size, and `data: { model }`. Nodes not in the plan are not rendered (Step 10 fades them out during the switch).
- `edges` is `[]` in plan modes.
- `CardNode.tsx`: one compact card for all kinds.
  - Sticky and rectangle: color strip or fill from `resolveColor`, title (rectangle) or text, cut off after 3 lines.
  - File: the file name (last part of the path) with a file icon.
  - Link: the URL without `https://`.
  - A status dot. On the Timeline, also the date.
  - No connection balls, no resize corner, no text editing.
- `PlanBackground.tsx`: draws the layout `regions` (lanes, lane titles, the arrow segments, the today highlight, the Unscheduled area). Render it inside `<ViewportPortal>` from `@xyflow/react` so it uses flow coordinates and pans and zooms with the cards. It has `pointer-events: none`.
- In the Timeline: a small `Days | Weeks | Months` control (new `webview/src/ui/TimelineScale.tsx`) at the top right. It saves the scale with `updateViewState`.
- An empty plan shows a hint in the middle: "Nothing here yet. In Chaos, right-click an item and choose Add to Board." (or Timeline).
- React Flow props in plan modes: `selectionOnDrag={false}`, nodes not connectable, `onConnect` / `onConnectEnd` not used.

### Step 6. Drag and drop in plan views

File: `webview/src/App.tsx`.

- In `onNodesChange`, when `mode !== 'chaos'`:
  - Do not call `moveNodes` or `applySnap`.
  - Keep the dragged card's position in a local `useState` "drag preview", so the card follows the pointer. This is UI only.
  - On the final change (`dragging === false`), compute the drop target with `boardDropTarget` or `timelineDropTarget` at the card's center, then call one store action:
    - Board, other lane or new index: `moveCard('board', id, { status, index })`.
    - Timeline, segment: `moveCard('timeline', id, { date: dropDate(...) })`.
    - Timeline, Unscheduled: `setDate([id], undefined)`.
    - `null`, or the same slot: no action.
  - Clear the drag preview. The card snaps into its slot from the new layout.
- Drag one card at a time in Phase 1. If several cards are selected, the drag moves only the card under the pointer.
- While a card is dragged, highlight the lane or segment under it (pass the current target to `PlanBackground`).
- `onNodeDragStop` / `onSelectionDragStop` must not call `commit` in plan modes. The store action commits.

### Step 7. View switcher, toolbar and keyboard

Files: new `webview/src/ui/ViewSwitcher.tsx`, `webview/src/ui/LeftToolbar.tsx`, `webview/src/App.tsx`.

- `ViewSwitcher`: a segmented control at the top center, `Chaos | Board | Timeline`, with the class `eb-ui` so pointer tracking ignores it. It calls `setMode` and saves the mode with `updateViewState`.
- Keyboard: `Alt+1`, `Alt+2`, `Alt+3` switch mode. Check first that VS Code has no default binding that wins in a webview. If there is a clash, keep only the switcher.
- `LeftToolbar`: show it only in `chaos` mode.
- In plan modes, the keydown handler:
  - Delete / Backspace: `removeFromPlan` for the selected cards. Never delete nodes.
  - Ctrl/Cmd+C, V, D: do nothing. Also ignore the `copy` and `paste` events.
  - Escape: clear the selection.
- Undo and redo work in every mode, because they go through the file. After an undo in a plan mode, the layout recomputes from the restored doc.
- A file with a parse error shows the same error card in every mode.

### Step 8. Context menus

File: `webview/src/ui/ContextMenu.tsx`.

- Chaos, on one or more selected nodes, after the existing items:
  - `Add to Board` or `Remove from Board` (whichever applies; with a mixed selection show both).
  - `Add to Timeline` or `Remove from Timeline`.
  - `Status ▸ Todo / In progress / Done`.
- Board card: `Show in Chaos`, `Status ▸ …`, `Remove from Board`.
- Timeline card: `Show in Chaos`, `Clear date`, `Remove from Timeline`.
- Plan view, empty space: no menu.
- `Show in Chaos` and double-click on a card: `setMode('chaos')`, select the node and center it. The switch animation moves the camera to a viewport centered on the node (the math of `rf.setCenter`), so that viewport is known when the animation starts (Step 3).

### Step 9. Chaos indicators

Files: `webview/src/nodes/StickyNode.tsx`, `RectangleNode.tsx`, `FileNode.tsx`, `LinkNode.tsx`, new `webview/src/nodes/PlanBadges.tsx`.

- `PlanBadges`: small dots in the top right corner of the node, one per plan the node is in (Board color, Timeline color). The tooltip shows the plan name, the status and the date.
- Done: the node is drawn at about 50 % opacity with a small check mark. It stays fully editable.
- Compute plan membership once per doc change (a `Map<nodeId, PlanType[]>` in a memo) and pass it in node `data`. Do not search the plans in every node render.
- The indicators must not change node size or the connection ball positions.

### Step 10. Morph animation

Files: `webview/src/App.tsx`, `webview/src/styles.css`.

- On `setMode`, put the class `eb-morphing` on the board root for 300 ms.
- CSS: `.eb-morphing .react-flow__node { transition: transform 300ms ease, opacity 300ms ease; }`. It applies only during the switch, so drags stay instant.
- Nodes keep their ids in every mode, so React Flow moves the same DOM element and the transform animates by itself.
- Leaving nodes (in the old mode, not in the new one): keep them in the `nodes` list for 300 ms with `opacity: 0` at their old position, then drop them.
- Entering nodes: start with `opacity: 0` at their new position and fade in.
- The viewport changes at the same time (Step 3). Use `rf.setViewport(v, { duration: 300 })` so the camera moves with the nodes.
- Node size also changes (Chaos size versus card size). Animate `width` and `height` too, or switch the size at the start of the animation. Pick what looks better in testing.
- `@media (prefers-reduced-motion: reduce)`: no transition, and the switch is instant.

### Step 11. Docs and final checks

- `README.md`: a new "Views" part under Features, new rows in the "Using the board" table, and the `konekton.plans` / `status` / `date` fields in "File format".
- `CHANGELOG.md`: a new version entry.
- Manual checks in the Extension Development Host:
  - Open `sample.canvas`, switch all views. The file is not marked as changed.
  - Add items, move cards, change the scale, undo and redo each step.
  - Delete a planned item in Chaos, then undo: it is back in the plans.
  - Edit the file as text while the board is open in a plan view.
  - Close and reopen the file: plans, statuses and dates are kept. The mode and the viewports are restored.
- `npm run typecheck`, `npm run lint`, `npm run test:unit` and `npm run test:integration` pass.

### Files touched

| File | Change |
|---|---|
| `src/shared/canvasFormat.ts` | `Plan`, `Status`, node `status` / `date`, parse and serialize top-level `konekton` |
| `webview/src/plans.ts` (new) | `planOf`, `planNodes`, `withPlan`, `withoutNodes`, `statusOf` |
| `webview/src/store.ts` | `mode`, plan actions, delete cleans plans, content actions only in Chaos |
| `webview/src/clipboard.ts` | Strip `status` / `date` from copies |
| `webview/src/vscodeApi.ts` | `ViewState` per mode, `updateViewState` merge, migrate `viewport` |
| `webview/src/layout/boardLayout.ts` (new) | Lanes, cards, drop target |
| `webview/src/layout/timelineLayout.ts` (new) | Arrow segments, cards, Unscheduled, drop target |
| `webview/src/layout/dates.ts` (new) | Local date math, segments, labels, drop date |
| `webview/src/App.tsx` | Nodes per mode, plan drag, keyboard rules, viewport per mode, morph |
| `webview/src/nodes/CardNode.tsx` (new) | Compact card for all kinds |
| `webview/src/nodes/PlanBadges.tsx` (new) | Plan dots and done mark in Chaos |
| `webview/src/nodes/*Node.tsx` | Show `PlanBadges`, done fade |
| `webview/src/ui/ViewSwitcher.tsx` (new) | `Chaos \| Board \| Timeline` |
| `webview/src/ui/TimelineScale.tsx` (new) | `Days \| Weeks \| Months` |
| `webview/src/ui/PlanBackground.tsx` (new) | Lanes, arrow, today mark, Unscheduled area |
| `webview/src/ui/ContextMenu.tsx` | Plan items per mode |
| `webview/src/ui/LeftToolbar.tsx` | Only in Chaos |
| `test/fixtures/plans.canvas` (new) | Fixture with plans, status and date |
| `test/unit/*.test.ts` | Format, plans, board layout, timeline layout, dates |
| `README.md`, `CHANGELOG.md` | Views and file format |

### Done when

1. You can switch between Chaos, Board and Timeline in any `.canvas` file. Switching does not change the file and adds no undo step.
2. In Chaos you can add items to the Board and the Timeline and remove them again. Chaos positions never change.
3. Dragging a card between Board lanes changes its status everywhere. Dragging inside a lane changes the order.
4. Dragging a card on the Timeline sets its date by the drop rule. Dragging it to Unscheduled clears the date.
5. The Timeline scale switches between Days, Weeks and Months without changing the file.
6. Every plan action is one undo step. Deleting an item in Chaos removes it from all plans, and undo brings it back.
7. Done items are faded with a check mark in Chaos, and items show their plan dots.
8. Switching views animates the nodes in about 300 ms, and is instant with reduced motion.
9. Files without plans round-trip to identical text. Typecheck, lint, unit and integration tests pass.

## Phase 2

- **Many plans**: several Boards and Timelines per file, with create, rename and delete. The view switcher lets you pick which plan to show. The format already stores a list.
- **Timeline dropdown on Chaos items**: pick which Timeline an item is in, with "create new timeline" in the dropdown.
- **Creating items from Board**: the new item is also created in Chaos. Open point: where it is placed on the Chaos canvas.
- **"Not planned" tray** in Board and Timeline: lists Chaos items that are not in the plan yet, so you can drag them in without going back to Chaos.
- **Custom Board lanes** (by person, room, …): the lanes belong to the plan, while status stays shared.
- **Faint connection lines** in Board and Timeline.
- **"Also add connected items?" prompt**: when you add an item to a plan, offer its directly connected items. Items the card points to are pre-ticked, items already in the plan are skipped, with "always add / never ask" per plan. A smaller first step: a right-click item `Add with connected` with no dialog.

### Later (not planned yet)

- Timeline order warnings: when A points to B, warn if B is scheduled before A.
- A "ready" gate in Chaos, if marking needs a separate step.
- Editing text in Board and Timeline.
- Start and end dates (bars) in the Timeline.
- An overdue indicator in Chaos, and click a plan dot to jump into that plan.
- Dragging several selected cards at once in plan views.
