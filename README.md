# KONEKTON

Visual Studio Code Extension that helps visualize your notes.

Open any `.canvas` file and get a Miro-like board: place sticky notes, rectangles, file references and links, move them around and connect them with lines to build simple flow charts.

## Features

On a virtual board (with grid toggle) you can place multiple objects:

- **Sticky notes** – coloured, square notes, just like in Miro.
- **Rectangles** – an optional bold title plus body text.
- **File references** – files from the folder of the `.canvas` file and its sub-folders. `.md`, `.txt` and `.json` files are shown as raw text and can be edited right on the board; changes are saved to the file. Other files show only their path.
- **Links** – an `http`/`https` URL; double-click opens it in your browser.

Every object shows four balls in the middle of its edges. Drag from a ball to another object to draw a curved connection line, or release on empty space to create a new object and connect it in one step. Lines have optional arrowheads and labels, and their end points can be moved along the border of an object or to another object.

Also included: infinite board with pan and zoom, grid with snapping, multi-select and box select, copy / paste / duplicate / delete, a right-click menu, and undo / redo through the normal VS Code commands (every board action is one undo step).

### Views: Chaos, Board and Timeline

One file, three views. Switch with the buttons at the top centre; the objects move to their new place in a short animation.

- **Chaos** (create) – the free board described above. It is the only view where you create, edit, move or delete objects.
- **Board** (plan) – the items you added to the Board as cards in three lanes: Todo, In progress, Done. Drag a card to another lane to change its status, or inside a lane to change the order.
- **Timeline** (do) – the items you added to the Timeline on a horizontal arrow. Pick Days, Weeks or Months at the top right. Drag a card onto a segment to set its date. A card dropped on a week or month keeps its date when it is already in that week or month, otherwise it gets the first day (Monday, or the 1st). Cards without a date sit in the Unscheduled area; drop a card there to clear its date.

Status and date belong to the item, so they are the same in every view. One item can be on the Board and on the Timeline at the same time. In Chaos, items on a plan show a small dot per plan in the top right corner, and done items are faded with a check mark. Board and Timeline never move items on the Chaos board.

### Using the board

| Action | How |
|---|---|
| Add an object | Pick a tool in the left toolbar, then click the board. |
| Move / select | Drag an object. Drag on empty board for a selection box. Shift+click adds to the selection. |
| Pan | Space + drag, middle mouse drag, or two-finger scroll on a trackpad. |
| Zoom | Mouse wheel, trackpad pinch, or the controls at the bottom right (click the percentage to reset to 100 %). |
| Edit text | Double-click an object. Esc or a click outside finishes. In a rectangle, Tab switches between title and body. |
| Connect | Drag from a ball. Release on an object, or on empty space to create a new one. |
| Move a line end | Select the line and drag the dot at its end. Dropping on empty space cancels. |
| Label a line | Double-click the line, or select it and use the toolbar. |
| Copy / paste / duplicate | Ctrl/Cmd+C, Ctrl/Cmd+V, Ctrl/Cmd+D, or the right-click menu. |
| Delete | Delete or Backspace, the toolbar, or the right-click menu. |
| Undo / redo | Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (inside a text field they act on the text). |
| Switch view | The **Chaos / Board / Timeline** buttons at the top centre. |
| Add to a plan | In Chaos, right-click one or more items and choose **Add to Board** or **Add to Timeline**. |
| Change status | In Chaos, right-click → **Status**. In Board, drag the card to another lane or use the right-click menu. |
| Change date | In Timeline, drag the card to a segment, or to Unscheduled to clear the date. |
| Take a card out of a plan | In Board or Timeline, select it and press Delete, or right-click → **Remove from Board / Timeline**. The item stays in Chaos. |
| Find a card in Chaos | Double-click the card, or right-click → **Show in Chaos**. |

### Hold Shift to drop files

You can drag files from the VS Code Explorer onto the board. VS Code only delivers drops to an editor webview while you **hold Shift**, so hold Shift when you release the file. One file reference is created per file. Files outside the folder of the `.canvas` file are allowed and stored with `../` paths.

### Creating a board

There is no "New Board" command in this version. Create an empty file with the `.canvas` extension (for example `ideas.canvas`) and open it. An empty file is a valid empty board. To see the raw JSON, use **Reopen Editor With… → Text Editor**.

## Settings

| Setting | Default | Description |
|---|---|---|
| `konekton.grid.enabled` | `false` | Show the board grid and snap objects to it. Also switched by the grid button on the board. User-level setting. |

## File format

Boards are [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) files. Konekton keeps its own data (kind of note, font size, line end offsets, …) in one `konekton` field on nodes and edges. Things it does not understand (for example `group` nodes) are kept in the file untouched. Compatibility with other canvas editors is not a goal of this version.

Plans live in a top-level `konekton` key, and status and date in the `konekton` field of each node:

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

`status` is `todo` (the default, not written), `inProgress` or `done`. `date` is a local calendar date, `YYYY-MM-DD`. Which view is open, the timeline scale and the camera of each view are kept per editor tab, not in the file. Files without plans are saved exactly as before.

## Limitations of version 1

- No groups / frames (`group` nodes are kept in the file but not shown), no Markdown rendering, no image or PDF previews.
- Only the standalone desktop app is supported. VS Code for the Web, Remote, WSL and Codespaces are not.
- Single workspace folder only.

## License

Konekton is licensed under the [PolyForm Shield License 1.0.0](https://polyformproject.org/licenses/shield/1.0.0) (the full text is in the `LICENSE` file): you may use, copy and change it, but you may not use it to provide a product that competes with it. Licenses of bundled packages are listed in `THIRD_PARTY_NOTICES.md`.

## Development

```sh
npm install
npm run build          # extension host (esbuild) + webview (Vite) into dist/
npm run watch          # rebuild on change
npm run typecheck
npm run lint
npm run test:unit      # Vitest
npm run test:integration   # downloads VS Code, runs the extension tests
npm run package        # builds konekton-<version>.vsix
```

Press F5 ("Run Extension") to start an Extension Development Host with the sample boards in `test/fixtures`.

Source layout: `src/extension` (extension host), `src/shared` (file format, protocol, paths – used by both sides, must not import `vscode`), `webview/src` (React + React Flow UI), `web/` (web app for testing: host, ports, dev-server plugin).

### Web version

For fast testing, the same board runs as a standalone web app:

```sh
npm run dev            # then open the printed address (default http://localhost:5173)
```

- Boards are real `.canvas` files in `boards/` (git-ignored). The folder is filled with copies of `test/fixtures/*.canvas` on the first start only. `KONEKTON_BOARDS=<path> npm run dev` uses another folder.
- The start page lists the boards and has **New board**. A board's address is `/?board=<name>.canvas`.
- Auto save 300 ms after the last change; Ctrl/Cmd+S saves at once. Undo/redo: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y (history is lost on page reload).
- The same file can be open in VS Code at the same time. An outside change reloads the board when nothing is unsaved; otherwise the board asks: **Reload from server** or **Save my version as `<name>_web.canvas`**.
- Not in the web version: file references (existing ones show their path only) and dropping files.
- Safety: the dev server stays on `localhost` and reads and writes only `.canvas` files directly in the boards folder. Do not use `--host`; the server refuses to start with it. Open it as `localhost`, not a LAN address: the clipboard needs a secure context.
- If outside changes are not seen (network drives, `/mnt/c` in WSL), try `CHOKIDAR_USEPOLLING=1 npm run dev`.
- The code: `web/server` (Vite plugin: board endpoints, request checks, file watching), `web/src/host` (`WebHost` answers the same messages as the extension's `BoardSession`), `web/src/ports` (storage, clipboard and tabs, dialogs, settings, view state – swap one to change where a feature comes from). The board UI is shared through `webview/src/bootstrap.tsx`.


### Manual test checklist

Run through this in the Extension Development Host before a release.

- [ ] Opening `test/fixtures/sample.canvas` shows the board; **Reopen Editor With… → Text Editor** shows JSON.
- [ ] `empty.canvas` opens as an empty board; the first edit writes valid JSON. A file with broken JSON shows the error overlay and **Open as text** works; the board never overwrites it.
- [ ] Create each object type from the left toolbar; Esc returns to the Select tool.
- [ ] Drag, box-select, Shift+click, resize (sticky stays square), grid on/off with snapping.
- [ ] Snapping: drag a sticky next to a rectangle: magenta guides appear at aligned edges, the sticky jumps into place, guides go away on release. Same at 25 % and 300 % zoom (pull distance and guide width look the same on screen).
- [ ] Snapping while resizing: drag the corner handle near another object's edge: the right/bottom edge jumps onto it with a guide; a sticky stays square. Ctrl/Cmd turns it off.
- [ ] Snapping: hold Ctrl (Cmd on Mac) mid-drag: guides go away and the object follows the pointer; release: it snaps again without moving the mouse.
- [ ] Snapping with grid on: objects snap to edges of off-grid objects, and to the grid otherwise; resize still snaps to the grid. One undo after a snapped drag restores the start position. Objects outside the visible area are never snapped to.
- [ ] Text toolbar: font size, colour, alignment, bold, delete. Each change is one undo step.
- [ ] Draw a line to an object, to a ball, and to empty space (chooser, including file and link). Esc cancels the chooser.
- [ ] Line toolbar: arrows, label (empty label disappears), delete. Drag a line end along its object and to another object; drop on empty space cancels.
- [ ] Copy / paste (at the mouse), duplicate, delete, right-click menus. Paste plain text creates a sticky.
- [ ] Undo / redo after every action above restores the previous state. In a text field, Ctrl+Z undoes the text only.
- [ ] File reference: preview, edit and save a `.md`; open it in a tab and change it there (live refresh); change it while editing (conflict banner, Reload / Overwrite); invalid `.json` shows the warning icon; delete the file (missing state) and restore it; a file over 1 MB shows "File too large to preview".
- [ ] Hold Shift and drop files from the Explorer onto the board.
- [ ] Mouse wheel zooms, trackpad scroll pans, pinch zooms, Space+drag pans; zoom controls and the 100 % reset work. Pan/zoom survives a tab switch.
- [ ] Link: double-click opens the browser; right-click → Edit URL; non-http URLs are rejected.
- [ ] Views: open `sample.canvas`, switch Chaos → Board → Timeline → Chaos. The file is not marked as changed and there is no undo step.
- [ ] Views: in Chaos add items to the Board and the Timeline (right-click). Drag cards between lanes and inside a lane, drag cards onto Days / Weeks / Months segments and to Unscheduled. Change the scale. Every drop is one undo step; switching and scale are none.
- [ ] Views: status and date set in one view show in the other. Done items are faded with a check mark in Chaos; items on a plan show their dots.
- [ ] Views: delete a planned item in Chaos, then undo: it is back in the plans. In Board/Timeline, Delete only removes the card from that plan; Ctrl+C/V/D do nothing.
- [ ] Views: double-click a card and use **Show in Chaos**: Chaos opens centred on the item, selected.
- [ ] Views: edit the file as text while a plan view is open; the view follows. Close and reopen the file: plans, statuses, dates, the open view and the cameras are restored.
- [ ] Views: with "reduce motion" on, switching is instant.

### Web version checklist

Run with `npm run dev` in Chrome and Firefox.

- [ ] `npm run dev` prints the address and the boards folder and does not open a browser. First start fills `boards/`; `git status` does not show `boards/`.
- [ ] Start page lists the boards. "New board" with name `plan` creates `plan.canvas` and opens it. Same name again: message, no overwrite. Name `../x`: message.
- [ ] Open `sample.canvas`. Create, move, connect, style objects. The file on disk updates about 300 ms after the last change. Ctrl/Cmd+S saves at once and shows no "Save page" box.
- [ ] The file tool and the "File reference" chooser item are missing. Existing file objects show their path, no "Loading…", no open button, no right-click "Open in editor".
- [ ] Undo/redo: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y. Each board action is one step. In a sticky's text, Ctrl+Z undoes the text only. Switching views or the timeline scale adds no step.
- [ ] Reload the page: the view, the cameras and the timeline scale are kept for this tab. Grid on/off is kept for all boards and follows in a second tab.
- [ ] Right-click Copy, then right-click Paste. Chrome asks once; Firefox shows a "Paste" button. Refused: nothing is pasted. Ctrl/Cmd+C/V need no permission.
- [ ] New link and Edit URL use the browser prompt; `ftp://x` is refused with a message. Double-click opens a new tab.
- [ ] Open the same board in VS Code. Change it there and save, with nothing unsaved in the browser: the browser board updates and shows "Reloaded: the file changed on server". Ctrl+Z does nothing then.
- [ ] Start typing in a sticky in the browser and keep the text field open. Change and save the same file in VS Code: the question appears (the typed text counts as unsaved). The board cannot be changed with mouse or keys while it is shown; Esc does not close it. "Reload" shows the VS Code version. "Save my version" opens `sample_web.canvas` (address changes); doing it again gives `sample_web-2.canvas`.
- [ ] Your own saves never show "Reloaded" or the question.
- [ ] Break the JSON in VS Code: the board shows "Cannot read this board". "Open as text" opens a tab with the error, the note and the raw text. Fix the file: the board and the raw tab both update.
- [ ] Delete the open board file outside: the start page opens with "The board was deleted on the server."
- [ ] Close the tab within 300 ms of a change: the browser asks first.
- [ ] `KONEKTON_BOARDS=/tmp/kb npm run dev` uses that folder.
- [ ] `npm run build` and the VS Code extension still work.
