const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const planPath = path.join(rootDir, 'plans', 'MASTER_PLAN.md');
const content = fs.readFileSync(planPath, 'utf8');

console.log('=== Verifying MASTER_PLAN.md Citations ===');
console.log(`Plan file: ${planPath}`);

const lines = content.split(/\r?\n/);
let currentSection = '';
let inImplemented = false;
let citationsChecked = 0;
let missingCitations = [];

// Match backtick or markdown links to files: e.g. `packages/sdk/...:line` or `crates/...:line` or `(../crates/...)`
const fileRegex = /((?:crates|packages)\/[a-zA-Z0-9_\-\.\/]+)(?::\d+)?/g;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## Phase 1') || line.includes('Status: Implemented')) {
        inImplemented = true;
    } else if (line.startsWith('## Phase 2') || line.startsWith('## Phase 3') || line.startsWith('## Phase 4')) {
        inImplemented = false;
    }

    if (line.startsWith('### ')) {
        currentSection = line;
    }

    if (inImplemented && (line.includes('Citation') || line.includes('`crates/') || line.includes('`packages/'))) {
        let match;
        while ((match = fileRegex.exec(line)) !== null) {
            const relPath = match[1];
            const fullPath = path.join(rootDir, relPath);
            const exists = fs.existsSync(fullPath);
            citationsChecked++;
            console.log(`[${exists ? 'EXISTS' : 'MISSING'}] ${relPath} (line ${i + 1})`);
            if (!exists) {
                missingCitations.push({ relPath, line: i + 1, section: currentSection });
            }
        }
    }
}

console.log('==========================================');
console.log(`Total Implemented citations checked: ${citationsChecked}`);
console.log(`Total missing: ${missingCitations.length}`);
if (missingCitations.length > 0) {
    console.log('Missing paths:');
    missingCitations.forEach(m => console.log(` - ${m.relPath} (line ${m.line}) in ${m.section}`));
    process.exit(1);
} else {
    console.log('All citations verified successfully.');
    process.exit(0);
}
