import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const dist = join(appRoot, 'dist');

await mkdir(dist, { recursive: true });
await copyFile(join(appRoot, 'index.html'), join(dist, 'index.html'));
await copyFile(join(appRoot, 'src', 'styles.css'), join(dist, 'styles.css'));

console.log(`client: static files copied to ${dist}`);
