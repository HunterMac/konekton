# Changelog

## Unreleased

- Web version: board name, file, todo name and URL questions open a proper dialog (inline error, clickable file list, Enter / Esc) instead of the browser prompt; messages open a dialog with OK instead of the browser alert.
- Web version on GitHub Pages with Google Drive sync: sign in with Google; boards and the text files they use live in the folder `konekton` of your Drive (scope `drive.file`); a working copy in the browser (IndexedDB) also works signed out; changes sync within 15 s, outside changes are fetched on open and on focus; a badge shows Synced / Not synced. When a browser never passes the token from Google's window back to the page, Reconnect signs in through Google's page in the same tab instead.
- Todo lists: a file reference to a `*.todo.md` file shows it as a todo list, with a **Todo / Text** switch. Tasks are GitHub checklist items with visible `#tag @person !date ~estimate` tokens and hidden data in an HTML comment (see `goals/todo/TODO-FORMAT.md`). Details open per task; subtasks, repeats, links between tasks, keyboard editing, drag and drop and undo are supported. New lists from the checklist tool or the line chooser.
- Todo lists have a **Board** mode: the list's top-level tasks as cards in Todo / In progress / Done lanes, per object, separate from the board-wide views.
- Todo lists have a **Timeline** mode, after Board: top-level tasks as cards under the Days / Weeks / Months segment of their due date, with an Unscheduled area. Drag a card to change its due date.
- Full todo editor: **Open fullscreen** on a todo object opens the file as an editor tab of its own (**Konekton Todo**, also under Open With… for any `*.todo.md`). Todo and Board mode with a fixed text size that follows the editor width, and a page that scrolls. **Canvas** goes back to the canvas that has a card for the file, with the card selected and centered.
- Web version start page: tabs **All / Canvas / Todo** filter the list; todo files (`*.todo.md`) are listed too, and a click opens the full todo editor. **Open fullscreen** on a todo card opens it in a new tab.
- Web version: file references and todo lists now work, on `.md`, `.txt` and `.json` files inside the boards folder (read, edit, save with conflict check, live updates, file picker, open the text in a new tab).

- Web version for testing: `npm run dev` runs the board as a standalone web app on `localhost`, with the boards as `.canvas` files in `boards/`.
- Three views in one file: **Chaos** (the free board), **Board** (Todo / In progress / Done lanes) and **Timeline** (a date arrow with Days, Weeks and Months), with a short morph animation between them.
- Add items to the Board and the Timeline from the Chaos right-click menu. Status and date are shared by all views and change by dragging cards or from the menu.
- Plans, status and date are stored in a top-level `konekton` key and in each node's `konekton` field. Files without plans are saved as before.
- Chaos shows a dot per plan on each item, and fades done items with a check mark.
- Each view keeps its own camera; the open view and the timeline scale are restored with the editor tab.

## 0.1.0

First version.

- Custom editor for `.canvas` files (JSON Canvas 1.0, own data in an `konekton` field).
- Sticky notes, rectangles, file references (`.md`, `.txt`, `.json` preview and editing) and links.
- Curved connection lines with arrowheads, labels and movable end points.
- Infinite board with pan, zoom, optional grid with snapping, multi-select and box select.
- Copy, paste, duplicate, delete, context menus; undo and redo through VS Code.
