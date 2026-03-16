const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const bump = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error(`Usage: node scripts/release.js [patch|minor|major]`);
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
}

function runSilent(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

function askClaude(promptText) {
  const tmpFile = path.join(__dirname, '..', '.tmp-prompt');
  fs.writeFileSync(tmpFile, promptText);
  try {
    const result = execSync(`cat "${tmpFile}" | claude --print --model haiku`, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 60000,
    }).trim();
    fs.unlinkSync(tmpFile);
    return result;
  } catch {
    try { fs.unlinkSync(tmpFile); } catch {}
    return null;
  }
}

// --- Step 1: Compile ---
console.log('\n=== Compiling ===\n');
run('npm run compile');

// --- Step 2: Stage & commit changes ---
console.log('\n=== Staging changes ===\n');
run('git add -A');

const hasChanges = (() => {
  try { runSilent('git diff --cached --quiet'); return false; }
  catch { return true; }
})();

if (hasChanges) {
  const diffStat = runSilent('git diff --cached --stat');
  const diffContent = runSilent('git diff --cached').slice(0, 8000);

  console.log('\n=== Generating commit message ===\n');
  const commitMsg = askClaude([
    'Generate a git commit message for these changes.',
    '',
    'Diff stat:', diffStat,
    '',
    'Diff (truncated):', diffContent,
    '',
    'Rules:',
    '- One line, max 72 characters',
    '- Conventional commit: type(scope): description',
    '- Types: feat, fix, chore, refactor, docs, ci',
    '- No period at end',
    '- Output ONLY the message, nothing else',
  ].join('\n')) || 'chore: pre-release changes';

  // Take first line only, strip any quotes
  const cleanMsg = commitMsg.split('\n')[0].replace(/^["']|["']$/g, '');
  console.log(`Commit message: ${cleanMsg}\n`);

  const msgFile = path.join(__dirname, '..', '.commit-msg');
  fs.writeFileSync(msgFile, cleanMsg);
  run(`git commit -F .commit-msg`);
  fs.unlinkSync(msgFile);
} else {
  console.log('Working tree clean, no commit needed.\n');
}

// --- Step 3: Bump version ---
console.log(`\n=== Bumping version (${bump}) ===\n`);

// Read current version, compute next
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const nextVersion = bump === 'major' ? `${major + 1}.0.0`
  : bump === 'minor' ? `${major}.${minor + 1}.0`
  : `${major}.${minor}.${patch + 1}`;

// --- Step 4: Generate changelog ---
console.log(`\n=== Generating changelog for v${nextVersion} ===\n`);

let lastTag;
try { lastTag = runSilent('git describe --tags --abbrev=0 HEAD'); }
catch { lastTag = runSilent('git rev-list --max-parents=0 HEAD'); }

const commits = runSilent(`git log ${lastTag}..HEAD --oneline`);
const diffStat = runSilent(`git diff ${lastTag}..HEAD --stat`);
const diff = runSilent(`git diff ${lastTag}..HEAD -- src/ package.json`).slice(0, 12000);

const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

const changelogEntry = askClaude([
  `Generate a changelog entry for v${nextVersion} of the "Hologram" VS Code extension.`,
  '',
  `Commits since ${lastTag}:`, commits,
  '',
  'Diff stat:', diffStat,
  '',
  'Code diff (truncated):', diff,
  '',
  `Output this exact format:`,
  '',
  `## ${nextVersion}`,
  '',
  'Then categorize changes under these headings (omit empty ones):',
  '### New Features',
  '### Improvements',
  '### Fixes',
  '',
  'CRITICAL RULES:',
  '- Output ONLY the markdown changelog entry',
  '- Do NOT explain, analyze, or add commentary',
  '- Do NOT wrap in code fences',
  '- Do NOT use brackets in version heading',
  '- One concise line per change',
  '- Bold feature names with **name**',
].join('\n'));

if (changelogEntry) {
  // Clean any code fences or preamble
  let cleaned = changelogEntry
    .replace(/^```(?:markdown)?\n?/, '')
    .replace(/\n?```$/, '')
    .trim();

  // Ensure it starts with ## version
  if (!cleaned.startsWith(`## ${nextVersion}`)) {
    const idx = cleaned.indexOf(`## ${nextVersion}`);
    if (idx > 0) cleaned = cleaned.slice(idx);
    else cleaned = `## ${nextVersion}\n\n${cleaned}`;
  }

  const updated = changelog.replace('# Changelog\n', `# Changelog\n\n${cleaned}\n`);
  fs.writeFileSync('CHANGELOG.md', updated);
  console.log(cleaned);
} else {
  // Fallback
  const entry = `## ${nextVersion}\n\n${commits.split('\n').map(c => `- ${c.replace(/^[a-f0-9]+ /, '')}`).join('\n')}`;
  const updated = changelog.replace('# Changelog\n', `# Changelog\n\n${entry}\n`);
  fs.writeFileSync('CHANGELOG.md', updated);
  console.log(entry);
}

// --- Step 5: npm version (commits package.json + CHANGELOG.md) ---
run('git add CHANGELOG.md');
run(`npm version ${nextVersion} --no-git-tag-version`);
run('git add package.json package-lock.json');
run(`git commit -m "v${nextVersion}"`);
run(`git tag v${nextVersion}`);

// --- Step 6: Push & release ---
console.log(`\n=== Publishing v${nextVersion} ===\n`);
run('git push');
run('git push --tags');

// Extract just this version's changelog for the release
const finalChangelog = fs.readFileSync('CHANGELOG.md', 'utf8');
const escaped = nextVersion.replace(/\./g, '\\.');
const match = finalChangelog.match(new RegExp(`## \\[?v?${escaped}\\]?\\n([\\s\\S]*?)(?=\\n## |$)`));
const releaseNotes = match ? match[1].trim() : `Release v${nextVersion}`;

const notesFile = path.join(__dirname, '..', '.release-notes');
fs.writeFileSync(notesFile, releaseNotes);
run(`gh release create v${nextVersion} --notes-file .release-notes`);
fs.unlinkSync(notesFile);

console.log(`\n=== Released v${nextVersion} ===\n`);
