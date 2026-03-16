const fs = require('fs');
const version = require('../package.json').version;
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

// Extract the section for the current version
const escaped = version.replace(/\./g, '\\.');
const pattern = new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`);
const match = changelog.match(pattern);

if (match) {
  console.log(match[1].trim());
} else {
  console.log(`Release v${version}`);
}
