Just like on Miro or Mural -
on virtual board, (with grid toggle)you can place on it multiple objects:

- Data Rectangles
- File References (from the current directory and sub-dirs)
- Sticky notes (just like in Miro!)


You can move objects around and easily connect them with connection lines.
Every object will present four balls in middle of the edges to connect lnes to other objects. This allows creating simple flow charts.


File format for saving the board: canvas (like in obsidian) - check if that will support our features.

File references - if thats text file like md or txt you can see text and edit it in the extension file view.

Those basics functionalities for version 1, nothing more advanced beyond.


## Open questions

All answers from question rounds 1 and 2 are now part of the implementation guide below. Still open (none of them block implementation):

1. **Final extension name.** Temporary name: `konekton`. The name also appears in the custom-field key in the file format (`konekton`, see 3.2) and in setting IDs. If the name changes after files exist, old files need a migration, so decide before the first public release.
2. **Publisher ID** for `package.json` (placeholder: `TODO-publisher`).
3. **Repository URL** for `package.json` (placeholder: `TODO-repository-url`).


## Implementation

### 1. Scope of v1

**In scope**

- Custom editor for `.canvas` files, set as the default editor.
- Four object types: sticky note, rectangle (title + text), file reference, link.
- Connection lines: curved, with optional arrowheads and labels. Lines attach to points on object edges that the user can move.
- Board: infinite canvas, pan/zoom (zoom range and reset), grid toggle with snapping, multi-select, box select.
- Editing: copy, paste, duplicate, delete, undo/redo.
- File references: preview and edit `.md`/`.txt`/`.json` on the board, live refresh, missing-file state, conflict warning, invalid-JSON warning.
- Ready to publish (packaging, license, README), but not published.

**Out of scope for v1**

- Groups/frames (`group` nodes are kept in the file but not shown).
- Markdown rendering, syntax highlighting, text auto-fit.
- Image/PDF previews (non-text files show only their path).
- Single-key tool shortcuts (Miro-style `N`, `L`, ...).
- Zoom-to-fit, minimap.
- User-selectable line color and line style.
- "New Board" command (users create an empty `.canvas` file themselves).
- Raw JSON side-by-side editing with sync.
- Obsidian compatibility.
- Multi-root workspaces; VS Code for the Web, Remote, WSL, and Codespaces. Only the standalone desktop app is supported.

### 2. Tech stack

| Area | Choice |
|---|---|
| Language | TypeScript (strict) |
| Extension host bundle | esbuild, output `dist/extension.js` (CommonJS) |
| Webview UI | React 18 + `@xyflow/react` 12.x (React Flow, MIT) |
| Webview state | `zustand` (React Flow also uses it internally) |
| Webview bundle | Vite, output `dist/webview/` |
| Icons | `@vscode/codicons` (only the icon font; no VS Code theme) |
| Unit tests | Vitest |
| Integration tests | `@vscode/test-cli` + `@vscode/test-electron` (Mocha) |
| Packaging | `@vscode/vsce`, `ovsx` (installed, not run for publishing) |
| Package manager | npm |
| Minimum VS Code | `"engines": { "vscode": "^1.123.0" }` (stable release from 2026-06-03). Pin `@types/vscode` to `~1.123.0`. |

Do not use the deprecated `@vscode/webview-ui-toolkit`. The board uses its own Miro-like white theme and ignores the VS Code color theme.

### 3. File format

#### 3.1 Base

The file is JSON Canvas 1.0 (https://jsoncanvas.org/spec/1.0/): a top-level object with `nodes` and `edges`. Node array order is z-order (first = bottom). Our own data goes into one namespaced field, `konekton`, on nodes and edges. Obsidian compatibility is not a goal, but the base fields follow the spec.

- `x`, `y`, `width`, `height` are integers. Round them on save.
- IDs: 16 lowercase hex characters, from `crypto.getRandomValues`.
- Paths in `file` nodes are relative to the folder of the `.canvas` file, always with `/` separators. `../` is allowed (only for files added by drag and drop, see 6.4).

#### 3.2 Node types

```jsonc
// Sticky note
{ "id": "a1b2c3d4e5f60718", "type": "text", "x": 0, "y": 0, "width": 200, "height": 200,
  "color": "3", "text": "Idea",
  "konekton": { "kind": "sticky", "fontSize": 18, "align": "center", "bold": false } }

// Rectangle
{ "id": "...", "type": "text", "x": 300, "y": 0, "width": 240, "height": 160,
  "color": "#FFFFFF", "text": "Body text",
  "konekton": { "kind": "rectangle", "title": "Title", "fontSize": 14, "align": "left", "bold": false } }

// File reference
{ "id": "...", "type": "file", "x": 0, "y": 300, "width": 320, "height": 240,
  "file": "docs/notes.md",
  "konekton": { "fontSize": 14, "align": "left", "bold": false } }

// Link
{ "id": "...", "type": "link", "x": 400, "y": 300, "width": 280, "height": 60,
  "url": "https://example.com" }
```

Missing `konekton` fields get the defaults from 3.4. A `text` node without `konekton.kind` loads as a rectangle with an empty title.

#### 3.3 Edges

```jsonc
{ "id": "...", "fromNode": "a1b2...", "fromSide": "right", "toNode": "c3d4...", "toSide": "left",
  "fromEnd": "none", "toEnd": "arrow", "label": "",
  "konekton": { "fromOffset": 0.5, "toOffset": 0.5 } }
```

- `fromSide`/`toSide`: `top` | `right` | `bottom` | `left`. Always written.
- `fromOffset`/`toOffset`: position along that side, `0`–`1` (0 = left/top end, 0.5 = middle). Default `0.5`.
- `fromEnd`/`toEnd`: `none` | `arrow`. Defaults: `none` at the start, `arrow` at the end (the spec defaults).
- `label`: omitted when empty.
- Line style is always curved and is not stored. Line color is fixed and is not stored.

#### 3.4 Colors and defaults

The 7-color palette is the 6 JSON Canvas presets plus white:

| Value | Name | Fill | Border (rectangle) |
|---|---|---|---|
| `"1"` | red | `#FFB3B3` | `#E06666` |
| `"2"` | orange | `#FFD199` | `#E69138` |
| `"3"` | yellow | `#FFF9B1` | `#E6C700` |
| `"4"` | green | `#D5F692` | `#8FBF3F` |
| `"5"` | cyan | `#A6E3F5` | `#45A6C9` |
| `"6"` | purple | `#DCC6FF` | `#9467D9` |
| `"#FFFFFF"` | white | `#FFFFFF` | `#C4C4C4` |

Other hex values from foreign files are shown as-is, with the border computed 25% darker.

| Object | Default size | Default color | Font size | Align |
|---|---|---|---|---|
| Sticky | 200×200 (always square) | yellow `"3"` | 18 | center |
| Rectangle | 240×160 | white | 14 | left |
| File reference | 320×240 | none (white card) | 14 | left |
| Link | 280×60 | none (white card) | 14 | left |

- Minimum size for all objects: 50×50.
- Font size list (fixed): 10, 12, 14, 18, 24, 36, 48, 64.
- The color applies to both fill and border on rectangles. Stickies have no border, only a light shadow.

#### 3.5 Serialization

- `JSON.stringify(data, null, 2)` + trailing newline. This keeps the file readable and diff-friendly.
- Stable key order. Nodes: `id, type, x, y, width, height, color, text|file|subpath|url|label, konekton`, then unknown keys. Edges: `id, fromNode, fromSide, fromEnd, toNode, toSide, toEnd, color, label, konekton`, then unknown keys.
- **Preserve what we don't understand.** Unknown keys on nodes and edges are kept and written back. Unsupported nodes (e.g. `group`), and edges pointing to them, are kept in the file in their original order but not shown.
- An empty file (0 bytes or whitespace) loads as an empty board. The first edit writes `{ "nodes": [], "edges": [] }` plus the change.
- Invalid JSON: the board shows an error overlay ("Cannot read this board: <parse error>") with a button that reopens the file in the text editor (`vscode.openWith` with `default`). The board never writes to a file it could not parse.

### 4. Architecture

#### 4.1 Project layout

```
konekton/
  package.json
  tsconfig.json                 # base; extension + shared
  esbuild.mjs                   # extension host bundle
  LICENSE                       # PolyForm Shield 1.0.0
  THIRD_PARTY_NOTICES.md        # MIT notices of bundled deps (React, React Flow, zustand, codicons)
  README.md  CHANGELOG.md  .vscodeignore
  media/icon.png                # 128×128 Marketplace icon
  src/
    extension/
      extension.ts              # activate(): register provider
      boardEditorProvider.ts    # CustomTextEditorProvider
      referencedFiles.ts        # read/write/watch referenced files
      webviewHtml.ts            # HTML + CSP + nonce
    shared/
      canvasFormat.ts           # types, parse(), serialize(), defaults
      protocol.ts               # message types (both directions)
      paths.ts                  # relative path helpers
  webview/
    vite.config.ts  tsconfig.json  index.html
    src/
      main.tsx  App.tsx  vscodeApi.ts  store.ts  sync.ts  geometry.ts  clipboard.ts  styles.css
      nodes/StickyNode.tsx  RectangleNode.tsx  FileNode.tsx  LinkNode.tsx  ConnectionBalls.tsx  ResizeCorner.tsx
      edges/CurvedEdge.tsx  EdgeLabel.tsx  EndpointDragger.tsx
      ui/LeftToolbar.tsx  TextToolbar.tsx  LineToolbar.tsx  ZoomControls.tsx  ContextMenu.tsx  NewObjectChooser.tsx
  test/
    unit/                       # Vitest: format, geometry, sync
    integration/                # @vscode/test-cli
    fixtures/                   # sample .canvas files incl. an Obsidian one with groups
```

`src/shared/` is imported by both the extension and the webview. It must not import `vscode`.

#### 4.2 package.json contributions

```jsonc
{
  "name": "konekton",
  "displayName": "Konekton",
  "publisher": "TODO-publisher",
  "license": "SEE LICENSE IN LICENSE",
  "repository": { "type": "git", "url": "TODO-repository-url" },
  "engines": { "vscode": "^1.123.0" },
  "categories": ["Visualization", "Other"],
  "main": "./dist/extension.js",
  "contributes": {
    "customEditors": [{
      "viewType": "konekton.board",
      "displayName": "Konekton Board",
      "selector": [{ "filenamePattern": "*.canvas" }],
      "priority": "default"
    }],
    "configuration": {
      "title": "Konekton",
      "properties": {
        "konekton.grid.enabled": {
          "type": "boolean", "default": false, "scope": "application",
          "description": "Show the board grid and snap objects to it."
        }
      }
    }
  }
}
```

No `activationEvents` are needed: VS Code generates `onCustomEditor:konekton.board` from the contribution. `scope: "application"` makes the grid setting per user (user settings only).

#### 4.3 Extension host: `BoardEditorProvider`

Register it with `vscode.window.registerCustomEditorProvider('konekton.board', provider, { webviewOptions: { retainContextWhenHidden: false }, supportsMultipleEditorsPerDocument: true })`.

`resolveCustomTextEditor(document, panel)`:

1. Set `webview.options = { enableScripts: true, localResourceRoots: [dist/webview] }`.
2. Set the HTML from `webviewHtml.ts`. Strict CSP: `default-src 'none'; script-src 'nonce-…'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:`. No remote resources.
3. On the `ready` message, send `init` with the document text, document version, grid setting, and the canvas folder URI.
4. On `workspace.onDidChangeTextDocument` for this document (includes undo/redo and changes from another view of the same file), send `docChanged` with the text. Skip it when `contentChanges` is empty.
5. On `edit` from the webview: build a `WorkspaceEdit` that replaces the full document range with the new text, then `workspace.applyEdit`. VS Code adds it to the undo stack and marks the file dirty. Ctrl+S, hot exit, and backup work automatically.
6. On `panel.onDidChangeViewState` → visible: send `refreshFiles` (re-read all referenced files).
7. On `workspace.onDidChangeConfiguration('konekton.grid.enabled')`: send `settings`.
8. Dispose listeners and file watchers on `panel.onDidDispose`.

#### 4.4 Message protocol (`src/shared/protocol.ts`)

Webview → extension:

| Message | Payload | Handling |
|---|---|---|
| `ready` | – | send `init` |
| `edit` | `{ text }` | full-document replace (4.3 step 5) |
| `watchFiles` | `{ paths[] }` | (re)create watchers, send `fileContent` for each |
| `saveFile` | `{ path, text, baseText }` | write the referenced file (6.4) |
| `pickFile` | `{ requestId }` | QuickPick (6.4), reply `pickFileResult { requestId, path? }` |
| `promptUrl` | `{ requestId, initial? }` | `showInputBox`, accept only `http:`/`https:`, reply `promptUrlResult` |
| `openFile` | `{ path }` | `vscode.window.showTextDocument(uri, { viewColumn: ViewColumn.Beside })` |
| `openUrl` | `{ url }` | `vscode.env.openExternal` (only `http:`/`https:`) |
| `setGrid` | `{ enabled }` | update the setting with `ConfigurationTarget.Global` |
| `reopenAsText` | – | `vscode.openWith(uri, 'default')` |

Extension → webview: `init`, `docChanged { text, version }`, `settings { gridEnabled }`, `fileContent { path, status: 'ok' | 'missing' | 'binary' | 'tooLarge', text? }`, `fileSaveResult { path, ok, error? }`, `refreshFiles`, `pickFileResult`, `promptUrlResult`.

#### 4.5 Webview state and sync (`store.ts`, `sync.ts`)

- The store holds the parsed `CanvasDoc` (the source of truth), preserved unknown data, and UI-only state: selection, edit mode, active tool, open menus, file contents.
- React Flow runs in controlled mode: nodes and edges are derived from the store.
- **Commit rule:** send `edit` only when an action ends, never during drags. Actions: drag stop, resize end, text edit commit, connect, reconnect, label commit, toolbar change, delete, paste, duplicate, create. One user action = one `edit` = one undo step. During a drag, positions update only in the store.
- **Echo suppression:** `sync.ts` remembers the last text it sent. If an incoming `docChanged.text` equals it, ignore the message. Otherwise parse the text and replace the doc. Keep selection for IDs that still exist, and stay in edit mode if the edited node still exists.
- Viewport (pan/zoom) is per view and is not saved in the file. Persist it with `vscode.setState()` so it survives tab switches.

### 5. Board

#### 5.1 Look

- Miro-like white theme: board background `#FFFFFF`, UI panels white with soft shadow, accent `#4262FF` (selection, balls, active tool).
- Grid (when on): React Flow `<Background variant="lines" gap={20} color="#EDEDED" />`. When off: plain white.

#### 5.2 Mouse and trackpad (close to Miro)

| Input | Action |
|---|---|
| Left-drag on empty board | box select (`selectionOnDrag`, `SelectionMode.Partial`) |
| Left-drag on object | move (all selected objects move together) |
| Shift+click | add to / remove from selection (`multiSelectionKeyCode="Shift"`) |
| Space + left-drag, middle-mouse drag | pan (`panActivationKeyCode="Space"`, `panOnDrag={[1]}`) |
| Mouse wheel | zoom around the cursor |
| Trackpad pinch (wheel event with `ctrlKey`) | zoom |
| Trackpad two-finger scroll | pan |

Wheel vs. trackpad detection (heuristic, like Miro's "auto" mode): in a custom `onWheel` handler, treat an event as a trackpad scroll when `deltaMode === 0` and it has a non-zero `deltaX` or a fractional `deltaY`. Otherwise treat it as a mouse wheel. Set `zoomOnScroll={false}` and `panOnScroll={false}`, and apply zoom/pan through `useReactFlow().setViewport`.

#### 5.3 Zoom controls (bottom right)

- `minZoom={0.1}`, `maxZoom={4}`.
- Panel: `−` button, percentage label, `+` button. Steps: 10, 25, 50, 75, 100, 150, 200, 300, 400 %. Clicking the percentage resets to 100%, centered on the current view center.
- Grid toggle button (codicon `symbol-numeric` or a grid icon) next to the zoom panel. It sends `setGrid`, and the button shows the on/off state.

#### 5.4 Grid snapping

- Grid on: `snapToGrid` with `snapGrid={[20, 20]}` for moving. New objects are placed snapped. Resizing snaps width/height to multiples of 20. Check whether React Flow's resizer uses `snapGrid`; if not, round in `onResizeEnd`.
- Grid off: free movement. Integer rounding still happens on save.

#### 5.5 Left toolbar (Miro-like, vertical, fixed on the left)

Tools from top to bottom: **Select** (default), **Sticky note**, **Rectangle**, **File reference**, **Link**.

- Click a tool, then click the board: the object is created centered on the click point, then the tool returns to Select.
- Sticky and rectangle: created and put straight into edit mode (the rectangle focuses the title).
- File reference: opens the QuickPick (6.4) first. Cancel = nothing is created.
- Link: opens the URL input box first. Cancel or invalid URL = nothing is created.
- Objects created from the toolbar are never auto-connected.
- Esc returns to the Select tool.

#### 5.6 Selection, clipboard, and editing commands

| Action | Keys | Also in |
|---|---|---|
| Delete | Delete, Backspace | context menu, toolbar trash button |
| Copy | Ctrl/Cmd+C | context menu |
| Paste | Ctrl/Cmd+V | context menu (object or board) |
| Duplicate | Ctrl/Cmd+D | context menu |
| Undo / Redo | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (VS Code's own commands) | – |

- These keys only act when the board has focus and no text field is in edit mode. In edit mode they act on the text.
- Deleting an object also deletes its lines.
- Copy puts the selected objects into a JSON fragment (`{ nodes, edges }`). Copied lines are only those with both ends in the selection. Use the DOM `copy`/`paste` events with a custom MIME type `application/x-konekton+json`, plus a `text/plain` fallback.
- Paste and duplicate create new IDs and remap edge ends. Paste places the copy at the mouse position if the mouse is on the board, otherwise +20/+20 from the original. Duplicate always uses +20/+20. The new objects become the selection.
- Pasting plain text that is not our JSON creates a sticky with that text.
- Undo/redo come from the TextDocument: the webview does not handle Ctrl+Z itself (no `preventDefault`) outside text edit mode.

#### 5.7 Context menu (right-click)

- On an object: Copy, Duplicate, Delete. File reference: + "Open in editor". Link: + "Open link", "Edit URL".
- On a line: Delete.
- On the empty board: Paste.
- Custom HTML menu. Block the default webview context menu with `data-vscode-context='{"preventDefaultContextMenuItems": true}'` on the board root and `preventDefault` on `contextmenu`.

### 6. Objects

#### 6.1 Common behavior

- **Selection:** a blue outline. A single selected sticky, rectangle, or file reference shows the text toolbar (6.6). A single selected line shows the line toolbar (7.4).
- **Resize:** a resize indicator in the bottom-right corner (diagonal-lines icon) on all four object types, visible on hover and on selection. Use React Flow `NodeResizeControl` with `position="bottom-right"`, `minWidth={50}`, `minHeight={50}`. Stickies use `keepAspectRatio` (always square).
- **Edit mode:** double-click enters it. Click outside or Esc commits and leaves it. While editing, the text element has the classes `nodrag nowheel nopan`, so dragging selects text and the wheel scrolls the text. Scrollbars appear when the text overflows.
- **Hover:** the four connection balls appear (7.1).

#### 6.2 Sticky note

- Square, fill color from the palette, no border, light shadow.
- Plain text, wraps, no auto-fit. Overflow is hidden outside edit mode and scrolls in edit mode.
- Font size, alignment, and bold from `konekton`. Bold applies to the whole note.

#### 6.3 Rectangle

- Fill and border both use the chosen color (3.4). Border 2 px, corner radius 4 px.
- Layout: a one-line title (bold, font size +2) above the body text. Both are plain text.
- Double-click on the title edits the title. Double-click on the body edits the body. Tab moves between them.
- An empty title takes no space outside edit mode.

#### 6.4 File reference

**Adding**

- **Toolbar → QuickPick:** one QuickPick that both lists and searches. Items come from `workspace.findFiles(new RelativePattern(canvasDir, '**/*'))`, showing relative paths. Search covers only the canvas folder and its sub-folders. `files.exclude` applies.
- **Drag and drop from the VS Code Explorer:** read `application/vnd.code.uri-list` (fall back to `text/uri-list`) from the drop event. Place one node per file at the drop point (stacked +20/+20). Files outside the canvas folder are allowed and get `../` paths. VS Code requires the user to **hold Shift** while dropping into a webview. Show a hint "Hold Shift to drop files onto the board" in the board while a drag is over it.

**Display**

- Header: relative path (ellipsis in the middle when long) + codicon file icon. Top-right button "Open in editor" (codicon `go-to-file`) sends `openFile` and opens a normal tab beside the board.
- Text files (`.md`, `.txt`, `.json`): body shows the raw file text (no Markdown rendering, no highlighting), using font size/alignment/bold from `konekton`. Overflow is hidden outside edit mode.
- Other files: header + "No preview" body.
- Files over 1 MB: "File too large to preview", no edit mode.
- Missing file (`FileNotFound`): greyed card, red dashed border, text "Missing file: <path>". The node and its lines stay. If the file reappears (watcher create event), the node returns to normal.

**Editing (text files only)**

- Double-click on the body enters edit mode: a `<textarea>` with the raw text and scrollbars when needed.
- Leaving edit mode (click outside, Esc) saves when the text changed. The webview sends `saveFile { path, text, baseText }`, where `baseText` is the content when editing started.
- The extension saves through VS Code's document model, so other tabs of that file see the change. Open it with `workspace.openTextDocument(uri)`, replace the full text with a `WorkspaceEdit`, then `document.save()`.
- If that document is already dirty in another tab, do not save. Show the conflict banner instead (below).

**Live refresh and conflicts**

- `referencedFiles.ts` creates one `FileSystemWatcher` per referenced file: `new RelativePattern(Uri.file(dir), basename)`. This also works for `../` paths. It also listens to `workspace.onDidChangeTextDocument` for open referenced files.
- On change: send `fileContent`. The node refreshes, except when it is in edit mode.
- Refresh all referenced files when the board tab becomes visible (4.3 step 6).
- **Conflict:** if the file changes while its node is in edit mode, or `baseText` no longer matches the file at save time, show a yellow banner in the node: "File changed on disk" with buttons **Reload** (discard the board edits, load the file) and **Overwrite** (write the board text).

**JSON validation**

- For `.json` files, run `JSON.parse` on load and after every save. If it fails, save anyway and show an exclamation icon (codicon `warning`, orange) in the top-right corner, left of the "Open in editor" button. The tooltip shows the parse error.

#### 6.5 Link

- Card with codicon `link` + the URL (one line, ellipsis). No preview, no toolbar.
- Double-click opens the URL in the external browser (`openUrl`).
- Edit URL: context menu → "Edit URL" opens the input box with the current URL.
- Only `http:` and `https:` URLs are accepted.

#### 6.6 Text toolbar

Use React Flow `NodeToolbar`, `position={Position.Top}`. Shown for a single selected sticky, rectangle, or file reference.

| Control | Sticky | Rectangle | File reference |
|---|---|---|---|
| Font size (dropdown, fixed list 3.4) | ✓ | ✓ | ✓ |
| Color (7 swatches) | ✓ | ✓ | – |
| Align left / center / right | ✓ | ✓ | ✓ |
| Bold toggle | ✓ | ✓ | ✓ |
| Delete (trash) | ✓ | ✓ | ✓ |

On a file reference, font size/alignment/bold are display settings stored in the board, not in the referenced file. Each change is one `edit` (one undo step).

### 7. Connections

#### 7.1 Connection balls

- Four balls (10 px circles, white fill, blue `#4262FF` border) in the middle of each side. Shown on hover and on selection, hidden otherwise (as in Miro).
- Each ball is a React Flow `Handle` (`type="source"`, `id` = side) with `ConnectionMode.Loose`, so a line can start from any ball.

#### 7.2 Drawing a line

1. Drag from a ball. React Flow draws a temporary curved line (custom `connectionLineComponent`, same style as 7.3).
2. Release over an object (anywhere on it, not only on a ball). In `onConnectEnd`, convert the pointer to flow coordinates (`screenToFlowPosition`) and find the object under it. The end point is the nearest point on that object's border, which gives `side` + `offset` (`geometry.ts`).
3. **Snap to middle:** if the point is within 15% of the side length (at least 12 screen px) of the middle, set `offset = 0.5`.
4. Release on the same object or on a ball of the same side: no line.
5. **Release on empty space:** open `NewObjectChooser` at the drop point with Sticky, Rectangle, File reference, Link. After a choice, create the object centered on the drop point (file/link go through QuickPick/input box first) and connect the line to it. The target side is the side of the new object that faces the source object: compare the center-to-center vector and use the dominant axis. Target offset = 0.5. Esc or click outside cancels, and no line is created.
6. A new line: `fromEnd: "none"`, `toEnd: "arrow"`, no label.

#### 7.3 Rendering (`CurvedEdge.tsx`)

- Custom edge type. It computes its own end points from the node rectangles + `side` + `offset`, not from React Flow handle positions. This is what makes free connection points possible.
- Path: cubic Bézier like Miro. The control points extend out of each side's normal by `max(40, 0.4 × distance)`. Use `getBezierPath` with the computed points and positions, or a custom formula.
- Fixed style: stroke `#1A1A1A`, 2 px. Arrowheads as SVG markers (`markerStart` / `markerEnd`) according to `fromEnd`/`toEnd`.
- Wider invisible hit path (12 px) for easier hovering and selecting.
- Lines to a missing node are not rendered (the file data stays).

#### 7.4 Line toolbar and labels

- A selected line shows a floating toolbar at the line's midpoint: **start arrow on/off**, **end arrow on/off**, **add label**, **delete**.
- Label: rendered at the midpoint through `EdgeLabelRenderer` (white background, 12 px). New lines have no label. Double-click on the line (or on the label, or "add label") edits it inline. An empty label is removed from the file.

#### 7.5 Moving connection points

- A selected line shows a drag dot on each end (`EndpointDragger.tsx`).
- Drag along the same object: the point slides along the border (switching sides at corners), with the middle snapping from 7.2 step 3.
- Drop on another object: the line reconnects to it, with side/offset from the drop point.
- Drop on empty space: the change is cancelled.
- When an object moves or resizes, its lines follow; offsets are relative, so points stay at the same relative position.

### 8. Testing

**Unit tests (Vitest, `test/unit/`)**

- `canvasFormat`: parse → serialize round trip gives identical text for our files. Obsidian fixture: groups, unknown fields, and edges to groups are preserved. Defaults are applied for missing `konekton`. Integer rounding. Key order. Empty file. Invalid JSON is reported, not thrown away.
- `geometry`: nearest side + offset for points around a rectangle, snap to middle, corner switching, new-object side choice.
- `sync`: echo suppression, selection kept after an external change, one `edit` per action (store-level test with a fake `postMessage`).
- `paths`: relative path from canvas folder, `../` paths, forward slashes.

**Integration tests (`@vscode/test-cli`, `test/integration/`)**

- Opening a `.canvas` fixture opens our custom editor (active tab input is `TabInputCustom` with `viewType === 'konekton.board'`).
- An `edit` message changes the document text and marks it dirty. `undo` restores the previous text.
- `saveFile` writes the referenced file. A dirty referenced document blocks the save with a conflict result.
- Grid setting changes reach the webview (`settings` message).

There are no UI end-to-end tests in v1. Manual test checklist goes into `README.md` (development section).

### 9. Build, run, and package

- Scripts: `build` (esbuild + Vite), `watch`, `test:unit`, `test:integration`, `lint`, `package` (`vsce package` creates `.vsix`).
- `.vscode/launch.json`: "Run Extension" (Extension Development Host with a `test/fixtures` folder).
- `.vscodeignore`: ship only `dist/`, `media/`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `README.md`, `CHANGELOG.md`, `package.json`.
- License: `LICENSE` with the official PolyForm Shield 1.0.0 text (https://polyformproject.org/licenses/shield/1.0.0), licensor = the author. Bundled dependency licenses go in `THIRD_PARTY_NOTICES.md`.
- README: features, screenshots (later), "Hold Shift to drop files", settings, license summary.
- Do not run `vsce publish` or `ovsx publish` in v1.

### 10. Milestones

Each milestone ends with its checks passing.

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold + spikes | Extension opens `.canvas` in an empty React Flow board. Spikes confirm: (a) Ctrl+Z in the board triggers VS Code undo on the TextDocument, and inside a `<textarea>` it acts on the text; (b) Shift+drop from the Explorer delivers `application/vnd.code.uri-list`; (c) DOM `copy`/`paste` events fire in the webview; (d) `NodeResizeControl` snapping behavior. Note the results in this file. |
| M1 | File format + sync | `canvasFormat` with unit tests. Board renders all node types read-only from a fixture. External edits and undo update the board. |
| M2 | Board basics | Pan/zoom mapping, zoom controls + reset, grid toggle + snapping, box select, multi-select drag, commit-on-drag-stop. |
| M3 | Sticky + rectangle | Left toolbar, creation, edit mode, resize, text toolbar, colors. |
| M4 | Connections | Balls, drawing, curved edges, arrows, labels, line toolbar, moving points, drop-on-empty chooser. |
| M5 | File references + links | QuickPick, Shift-drop, preview, edit + save, watcher, missing state, conflict banner, JSON warning, open in editor, link nodes. |
| M6 | Editing commands | Copy, paste, duplicate, delete, context menus, undo/redo checked across all actions. |
| M7 | Tests + packaging | Unit + integration tests green, `vsce package` builds a `.vsix` that installs and works, README, LICENSE, notices. |

### 11. Known risks

- **Undo routing in webviews (M0 spike a):** if VS Code's undo does not reach the TextDocument while the board is focused, add a fallback: the webview catches Ctrl+Z outside text edit mode and sends `undo`/`redo`, and the extension runs `vscode.commands.executeCommand('undo')`.
- **Explorer drop needs Shift:** this is a VS Code limitation. The hint in 6.4 is the mitigation.
- **Trackpad vs. wheel detection** is heuristic. Some mice with smooth scrolling may pan instead of zoom. If this is a problem, add a setting later (`auto` / `mouse` / `trackpad`, as in Miro).
- **Performance:** controlled React Flow with hundreds of nodes is fine. File previews over 1 MB are blocked to keep the webview responsive.


### 12. M0 spike results and deviations (filled in during implementation)

Spikes were run against a real VS Code 1.143.0 (Linux desktop build, started through `@vscode/test-electron`, driven over the Chrome DevTools protocol).

- **(a) Undo routing:** works. With the board focused, Ctrl+Z / Ctrl+Shift+Z reach the TextDocument; no fallback needed. **But** the webview host (`webview/browser/pre/index.html`, `handleInnerKeydown`) turns Ctrl/Cmd+Z/Y into document undo/redo *also inside text fields*, so a `<textarea>` did not undo its own text. Fix: the text fields call `stopPropagation()` on those keys (`webview/src/ui/textKeys.ts`) so the host listener on `window` never sees them. Verified: inside the textarea Ctrl+Z undoes the typed text and leaves the document alone.
- **(b) Shift+drop from the Explorer:** not verified. It cannot be driven through the DevTools protocol (native drag and drop). The code reads `application/vnd.code.uri-list` / `text/uri-list` as designed and is covered by a browser test with a synthetic `DataTransfer`. Check it by hand (README checklist). Note that VS Code only delivers the drop events while Shift is held, so the "Hold Shift" hint can only appear once the user already holds Shift; the README and the file tool's tooltip carry the same text.
- **(c) DOM `copy` / `paste`:** work. Ctrl+C / Ctrl+V on the board fire the events in the webview and our handlers run (the host re-dispatches them). The custom MIME type may not survive between windows, so the `text/plain` fallback carries the same JSON.
- **(d) `NodeResizeControl` and snapping:** the resizer snaps the *pointer position* to `snapGrid` when `snapToGrid` is on (`XYResizer` in `@xyflow/system`), which gives multiples of 20 for nodes that sit on the grid. `finishResize` also rounds width/height to the grid (minimum 50) so nodes that are off-grid end up on it.

Deviations from the guide:

- `@types/vscode` is pinned to `1.120.0`: there is no `1.123.x` on npm (only 1.120.0 and 1.125.0 exist around that version). `engines.vscode` stays `^1.123.0` (vsce requires types ≤ engine).
- TypeScript 5.9 is used instead of 7.x (tooling compatibility). Vite 8 / Vitest 5 / ESLint 9 are current.
- Messages added to the protocol: `resolveDroppedFiles` (the webview sends dropped URIs, the host answers with paths relative to the canvas folder) and `clipboardWrite` / `clipboardRead` (the context menu cannot use the web clipboard API reliably in a webview). `refreshFiles` is not a message: when the tab becomes visible the host re-reads the referenced files itself.
- Lines, their end-point dots and their toolbar are drawn through React Flow's `ViewportPortal` so they sit above the objects and the connection balls (`EdgeLabelRenderer` renders below objects).
- React Flow nodes are given `measured` equal to their size. Without it, React Flow drops the handle bounds whenever a node object changes and every line disappears for a frame.
- With an object tool active, a click on an existing object also places the new object (React Flow only reports pane clicks for empty space).
- `README.md` has no relative links: `vsce package` refuses relative links while the repository URL is still `TODO-repository-url`.
