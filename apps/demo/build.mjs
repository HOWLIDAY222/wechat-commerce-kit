// Copyright 2026 青岛屿漠商贸有限公司. SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const destination = path.join(root, 'dist');
export const PUBLIC_FILES = ['index.html', 'styles.css', 'app.js', 'demo-state.mjs', 'assets/mark.svg', 'assets/canvas-tote.png', 'assets/notebook-set.png'];
await fs.mkdir(destination, { recursive: true });
for (const relative of PUBLIC_FILES) {
  const output = path.join(destination, relative);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.copyFile(path.join(root, relative), output);
}
console.log(`Built ${PUBLIC_FILES.length} static showcase files. No environment files, backend or database included.`);
