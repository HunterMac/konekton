# KONEKTON

Visual Studio Code Extension that helps visualize your notes.

Open any `.canvas` file and get a Miro-like board: place sticky notes, rectangles, file references and links, move them around and connect them with lines to build simple flow charts.

## Features

On a virtual board you can place multiple objects:

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

### Todo lists

A file reference to a `*.todo.md` file (or a `TODO.md`) shows the file as a todo list. The **Todo / Board / Timeline / Text** switch in its header changes between the list, the list as lanes, the list on a date arrow, and the raw Markdown. Each object has its own switch, separate from the Chaos / Board / Timeline views of the whole board. Create a new list with the checklist tool in the left toolbar, or **Todo list** in the chooser at the end of a line: it asks for a name and creates `<name>.todo.md` next to the `.canvas` file.

The file stays plain Markdown. Each task is a GitHub checklist item with its title only; all other data (due date, estimate, tags, people, id, priority, note, …) is kept in an HTML comment that Markdown previews hide:

```markdown
- [ ] Prepare project report <!--
  due: 2026-11-14
  estimate: 2h
  tags: work
  people: Anna
  id: k3f9
  priority: high
  note: Include financial results.
  -->
  - [x] Collect numbers <!--
    id: p0a2
    done: 2026-11-12
    -->
- [ ] Pay rent <!--
  due: 2026-12-01
  repeat: +1m
  -->
```

- Tokens: type `#tag`, `@person`, `!2026-11-14` (due date; `!today`, `!tomorrow`, `!fri`, `!+3d` become a date) and `~30m` / `~2h` / `~1d` (estimate) in the title; when the title is saved they move into the comment (`tags`, `people`, `due`, `estimate`) and show as chips. Older files with these tokens on the task line are still read, and change to the comment form when the task changes.
- A closed task is one line: checkbox, title, chips, and the progress of its subtasks. Click its title (or press Enter) to open its details in a window just right of the title (as tall as its fields), level with the task. Only one such window is open on the board; Esc, its ×, or a click on the empty board closes it. It always shows the **Status** (**Todo**, **In progress**, **Done**; Done is the checkbox, In progress is `status: inProgress`, Todo has no key; an older `waiting` or `cancelled` shows as a fourth choice while it is set), then holds the description (the `note` key in the file), the fields that have a value, **+ Add field** (due, estimate, priority, start, repeat, reminder, waits for, related, today, proof, …), **+ Add subtask** (adds one at the end of its subtasks and starts typing) and **Text**, which edits the Markdown of just that task.
- A ball at the right end of a task row (shown while the row is hovered) starts a line to another object on the board. The line is saved in the `.canvas` file as an edge with `konekton.fromTask` set to the task's `id` (the id is added to the task's comment when it has none); the todo file does not know about the canvas. Not in Board mode.
- `repeat: 3d` repeats 3 days after it is done; `repeat: +1m` every month on a fixed date. Marking a repeating task done moves it to its next date.
- Marking a parent done while subtasks are open asks first.
- Zoomed far out, the list shows only `done/total` and the overdue count.
- Konekton rewrites only the lines of the tasks you change. A change of the file on disk while a save is on its way shows a banner with **Reload** and **Overwrite**.

| Key (task selected) | Action |
|---|---|
| Up / Down | Select the previous / next task |
| Space | Next status: Todo → In progress → Done → Todo |
| Enter | Open or close the task |
| F2 | Edit the title in the list. The tags, people, date and estimate show as chips under it (× removes one); new ones can be typed in the title, and a typed date or estimate replaces the old one. Enter saves and starts a new task, Esc saves, Tab accepts a suggested `#tag` / `@person` |
| Ctrl/Cmd+Enter | New task below |
| Tab / Shift+Tab | Make it a subtask of the task above / move it one level up |
| Alt+Up / Alt+Down | Move the task with its subtasks |
| Left / Right | Hide / show subtasks |
| Delete | Delete the task with its subtasks |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | Undo / redo list edits |
| Esc | Leave the list |

A click on a task title (it underlines on hover) opens the details window, with the title ready to edit there: Enter or a click outside saves, Esc goes back. A title needs at least 3 characters (tags, people, dates and estimates do not count): a shorter one gets a red border and is not saved, the old title stays, and a new task left with a too-short title is removed.

Drag a task by the grip on its left edge to move it; drop it on the right part of another task to make it a subtask.

**Board** mode shows the top-level tasks of the list as cards in **Todo**, **In progress** and **Done** (`status: inProgress` is In progress; done and cancelled tasks are Done). Drag a card to another lane to change its status, or up and down to change the order; a click on the checkbox moves it to the next lane (Todo → In progress → Done → Todo). A move to Done of a task with open subtasks asks first. The blue **Add new** button in the Todo lane header adds a card. A click on the card title (or Enter) opens the same details window. Keys: Up/Down select, Left/Right move the card to the next lane, Space next status, Enter details, F2 edit the title, Delete, Ctrl/Cmd+Z undo.

**Timeline** mode shows the top-level tasks as cards under the Days, Weeks or Months segment of their due date; tasks without a due date are in **Unscheduled**. Drag a card to another segment to change its due date, or to Unscheduled to clear it. Click a card title (or press Enter) for the details window, Ctrl/Cmd+Z undoes.

**Fullscreen.** The **Open fullscreen** button in the header of a todo object (or right-click → **Open fullscreen**) opens the file as an editor tab of its own, the **Konekton Todo** editor. It has the same list and Board mode, and the same keys and details window, but no board around it: the text has a fixed size that follows the width of the editor (13 px up to 20 px, no zoom), and the page scrolls (down for a long list; sideways when the three lanes do not fit). **Text** opens the Markdown. **Canvas** (shown when a `.canvas` file in the workspace has a card for this file) goes back to that canvas with the card selected and centered; with several canvases it goes to the one you came from, or asks. You can also open any `*.todo.md` this way with right-click on the tab or file → **Open With… → Konekton Todo**. In the web version a click on a todo file in the start page opens it (`/?todo=<path>`), and **Open fullscreen** on a card opens it in a new tab; **Canvas** closes that tab (or, when it was not opened from a card, goes to the first board that has the file). The web version does not center the card.

### Hold Shift to drop files

You can drag files from the VS Code Explorer onto the board. VS Code only delivers drops to an editor webview while you **hold Shift**, so hold Shift when you release the file. One file reference is created per file. Files outside the folder of the `.canvas` file are allowed and stored with `../` paths.

### Creating a board

There is no "New Board" command in this version. Create an empty file with the `.canvas` extension (for example `ideas.canvas`) and open it. An empty file is a valid empty board. To see the raw JSON, use **Reopen Editor With… → Text Editor**.

## Web version on GitHub Pages

The same web app runs as a static site at `https://huntermac.github.io/konekton/`. Boards live in your own Google Drive.

- **Sign in with Google.** The app asks only for the `drive.file` scope: it sees the files and folders it made itself, nothing else in your Drive.
- Your files are in the Drive folder `konekton` (in My Drive). Boards are `<name>.canvas` there; the text files and todo lists the boards use sit next to them, in the same relative paths. The app makes the folder on first use. Files you add to the folder by hand in Drive are not shown, and a `konekton` folder made by hand is not used (the app makes its own).
- A working copy of every file is kept in the browser (IndexedDB), so the app also works signed out and after a reload. Signed out, boards stay in this browser; at sign-in they upload to the account.
- **What syncs when.** A change goes to Drive at once if nothing was synced for 15 seconds, otherwise 15 seconds after the last sync. Ctrl/Cmd+S syncs at once. A sync overwrites the Drive file; it does not look at Drive first. Outside changes (another browser, Drive) are fetched when the page opens and when the tab gets focus, at most every 5 minutes. If a file changed on Drive while you have unsynced changes, the app asks: **Reload from Drive** or **Save my version as `<name>_web.canvas`**. A synced file that was deleted, trashed or moved out of `konekton` on Drive: the app asks whether to write it again or delete your local copy.
- **The badge** (top right) says **Synced**, or **Not synced** with the reason (signed out, waiting, syncing, a question is open, offline or another error) and the button for it. A Google token lasts about an hour; after that the next click or key press renews it. If the browser blocks the Google window, a **Reconnect** button shows.
- Only one tab per browser syncs; the others show its status.
- **Clearing the site data of the browser loses changes that are not synced yet.** Local copies are kept per Google account and stay after sign-out.

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
- File references and todo lists work on `.md`, `.txt` and `.json` files inside the boards folder and its subfolders. The file tool asks for a path and lists the files; **Open in editor** opens the file's text in a new tab. Not in the web version: dropping files.
- Safety: the dev server stays on `localhost`. It reads and writes `.canvas` files directly in the boards folder, and `.md`, `.txt` and `.json` files inside it (no `..`, no hidden folders, no symlinks leading out). Do not use `--host`; the server refuses to start with it. Open it as `localhost`, not a LAN address: the clipboard needs a secure context.
- If outside changes are not seen (network drives, `/mnt/c` in WSL), try `CHOKIDAR_USEPOLLING=1 npm run dev`.
- The code: `web/server` (Vite plugin: board endpoints, request checks, file watching), `web/src/host` (`WebHost` answers the same messages as the extension's `BoardSession`), `web/src/ports` (storage, clipboard and tabs, dialogs, settings, view state – swap one to change where a feature comes from). The board UI is shared through `webview/src/bootstrap.tsx`.

#### Drive mode (Google sign-in) in development

```sh
VITE_KONEKTON_STORAGE=drive VITE_GOOGLE_CLIENT_ID=<client id> npm run dev   # http://localhost:5173
npm run build:web                                                            # static site into dist-web/
KONEKTON_BASE=/konekton/ VITE_GOOGLE_CLIENT_ID=<client id> npm run build:web  # as on GitHub Pages
```

- Without `VITE_KONEKTON_STORAGE`, `npm run dev` keeps the dev-server storage. A production build uses Drive mode (`VITE_KONEKTON_STORAGE=devserver` turns it off).
- Google Cloud setup (once, free, no billing account needed; if Google asks for a card, stop): create a project, enable the **Google Drive API**, configure the OAuth consent screen (External, scope `https://www.googleapis.com/auth/drive.file`, publishing status "In production"), create an OAuth client of type **Web application** with the authorized JavaScript origins `https://huntermac.github.io` and `http://localhost:5173`. The client ID is public by design.
- GitHub: repository settings, Pages source **GitHub Actions**; Actions variable `GOOGLE_CLIENT_ID` with the client ID. `.github/workflows/pages.yml` builds and deploys on every push to `main`.
- The code: `web/src/sync` (`localStore` and `localPorts`: the working copy behind the same ports as the dev server; `googleAuth`; `driveApi` and `driveTree`; `syncEngine`; `syncCoordinator`: one syncing tab), `web/src/ui/SyncBadge.tsx`.


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
- [ ] Todo list: the checklist tool creates `<name>.todo.md` (an existing name is refused) and shows it in todo mode. Add tasks with tokens, nest them (Tab, drag), mark done (Space), open details and add fields. The file in a text tab shows the changes; GitHub/VS Code preview hides the comments.
- [ ] Todo list: Ctrl+Z inside the list undoes the list edit, not a board edit. Edit the file in a text tab while the board is open: the list follows. Change the file outside while a save is on its way: banner, Reload / Overwrite.
- [ ] Todo list: **Text** switch shows the raw file and is one board undo step; **Todo** switches back. Zoom below 40 %: summary only.
- [ ] Todo list **Board** mode: cards are in the right lanes. Drag between lanes and inside a lane; the file changes. Drop a task with open subtasks on Done: the question appears. Left/Right move the selected card. The board-wide Chaos / Board / Timeline switch is not affected.
- [ ] Todo list: **Open fullscreen** (button and right-click) opens the Konekton Todo tab. Todo and Board work as on the board; the text size follows the width of the editor when the sidebar opens or closes; the page scrolls, the lanes scroll sideways in a narrow editor; the details window stays inside the page. **Canvas** goes back with the card selected and centered (also when the canvas tab was open in another group). Open the file from the Explorer with Open With… → Konekton Todo: **Canvas** shows only when a canvas has a card for it. Edit in the fullscreen tab and in the card at the same time: both follow.
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
- [ ] File tool: the prompt lists the `.md`/`.txt`/`.json` files of the boards folder; an unknown path is refused. The object shows the file; edit it on the board and the file on disk changes. Change the file in VS Code: the board follows. **Open in editor** opens a tab with the text.
- [ ] Todo lists: the checklist tool asks for a name and creates `<name>.todo.md` (a taken name: message, asks again). Add, nest, mark done and edit tasks; the file on disk changes. Change it in VS Code: the list follows.
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

### Remote files checklist

Run on `VITE_KONEKTON_STORAGE=drive npm run dev` with two browser profiles A and B signed in to the same Google account, and once on the deployed site, in Chrome and Firefox.

- [ ] Signed out: create a board and a todo file; reload; both are there; badge "Not synced · Signed out".
- [ ] Sign in: Google's window once; the signed-out board uploads; Drive shows `konekton/<board>.canvas`; badge "Synced".
- [ ] Edit a board: the badge shows "Not synced" and turns "Synced" within about 15 s; several edits within 15 s give at most one upload at once and one 15 s later (network panel).
- [ ] Ctrl/Cmd+S uploads at once.
- [ ] Profile B: the board appears on open. Edit in A, wait for "Synced", focus B after 5 minutes: B shows the change ("Reloaded").
- [ ] Edit in B without waiting for sync, change the same board in A and sync, focus B after 5 minutes: the Reload / Save as copy question. "Save my version" opens `<name>_web.canvas`, which then appears in Drive.
- [ ] Delete a synced file in Drive (and separately: move one out of `konekton`): on refresh the "removed on Drive" question. "Write it again" restores it in Drive; "Delete my copy" removes it locally; an open board goes to the start page with the note.
- [ ] Two files with the same path (create the same new board in A and B while offline, then go online): warning, newest used.
- [ ] A `konekton` folder made by hand in a fresh Google account: the app makes its own second `konekton` (accepted limit).
- [ ] Wait until the token ends (about 1 hour): status "Click or type to reconnect"; the next key press renews it (or the Reconnect button shows in a browser that blocks the window).
- [ ] Two tabs in one profile: only one uploads; both badges agree.
- [ ] Offline: badge shows Offline; edits keep saving locally; back online they upload.
- [ ] Sign out: the app shows the signed-out space; signing in again shows the account's boards.
- [ ] `npm run dev` without variables works as before (dev-server storage, outside changes from VS Code).
- [ ] Deployed site: all links stay under `/konekton/`; sign-in works from that origin.
