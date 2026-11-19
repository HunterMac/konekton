import { bootstrap, bootstrapTodo } from './bootstrap';
import { createVsCodeHost } from './vscodeHost';

const root = document.getElementById('root') as HTMLElement;
// The extension marks the full todo editor in its HTML.
if (document.body.dataset.view === 'todo') bootstrapTodo(createVsCodeHost(), root);
else bootstrap(createVsCodeHost(), root);
