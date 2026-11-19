import * as vscode from 'vscode';

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64');
}

/** HTML for the board webview, or with `view` "todo" for the full todo editor. Strict CSP, no remote resources. */
export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, view: 'board' | 'todo' = 'board'): string {
  const dist = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'assets', 'main.js'));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'assets', 'main.css'));
  const n = nonce();
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${n}'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} data:`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${style}">
  <title>Konekton</title>
</head>
<body data-view="${view}">
  <div id="root"></div>
  <script nonce="${n}" type="module" src="${script}"></script>
</body>
</html>`;
}
