// Add visual separation around top-level declarations and statement blocks.
const fs = require('node:fs');
const path = require('node:path');

const sourceFolder = path.resolve(__dirname, '../src');

for (const filename of fs.readdirSync(sourceFolder)) {
  if (!/\.(?:ts|cts|mts)$/.test(filename)) continue;

  const fullPath = path.join(sourceFolder, filename);
  const source = fs.readFileSync(fullPath, 'utf8');
  const lines = source.split(/\r?\n/);
  const spaced = [];

  for (const line of lines) {
    const previous = spaced[spaced.length - 1] || '';
    const startsDeclaration = /^(?:export )?(?:async )?(?:function|class|interface|type) /.test(
      line,
    );
    const startsBlock = /^  (?:if|for|try|return)\b/.test(line);
    const endsStatement = /[;}]\s*$/.test(previous);

    if (previous.trim() && (startsDeclaration || (startsBlock && endsStatement))) {
      spaced.push('');
    }

    spaced.push(line);
  }

  fs.writeFileSync(fullPath, spaced.join('\n'));
}
