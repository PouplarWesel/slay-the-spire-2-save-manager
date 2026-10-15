const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const outputFolder = path.join(projectRoot, 'build');

fs.mkdirSync(outputFolder, { recursive: true });

for (const asset of ['index.html', 'style.css', 'steam-helper.ps1']) {
  fs.copyFileSync(path.join(projectRoot, 'src', asset), path.join(outputFolder, asset));
}
