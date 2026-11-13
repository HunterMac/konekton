# Changelog

## Unreleased

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
