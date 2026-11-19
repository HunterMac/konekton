import * as vscode from 'vscode';
import { BOARD_VIEW_TYPE, BoardEditorProvider, type KonektonApi } from './boardEditorProvider';
import { TODO_VIEW_TYPE, TodoEditorProvider } from './todoEditorProvider';

export const VIEW_TYPE = BOARD_VIEW_TYPE;

export function activate(context: vscode.ExtensionContext): KonektonApi {
  const provider = new BoardEditorProvider(context.extensionUri);
  const todos = new TodoEditorProvider(context.extensionUri, provider);
  provider.setTodoOpener((uri, origin) => todos.open(uri, origin));
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.window.registerCustomEditorProvider(TODO_VIEW_TYPE, todos, {
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: true,
    }),
  );
  return { getSessions: () => provider.sessions(), getTodoSessions: () => todos.sessions() };
}

export function deactivate(): void {}
