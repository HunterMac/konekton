import { bootstrap } from './bootstrap';
import { createVsCodeHost } from './vscodeHost';

bootstrap(createVsCodeHost(), document.getElementById('root') as HTMLElement);
