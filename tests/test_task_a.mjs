import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import {
  computeFileDiff,
  assembleContent,
  acceptHunk,
  rejectHunk,
  acceptAllHunks,
} from '../extension/src/diffEngine';

console.log('Running Task A Verification Suite (pallets/flask get_debug_flag)...\n');

const flaskDir = path.resolve('D:\\flask');
const helpersPath = path.join(flaskDir, 'src', 'flask', 'helpers.py');
const pythonExe = path.join(flaskDir, '.venv', 'Scripts', 'python.exe');
const pytestExe = path.join(flaskDir, '.venv', 'Scripts', 'pytest.exe');

assert.ok(fs.existsSync(helpersPath), `helpers.py must exist at ${helpersPath}`);
assert.ok(fs.existsSync(pythonExe), `Python venv must exist at ${pythonExe}`);

const originalContent = fs.readFileSync(helpersPath, 'utf-8');
const eol = originalContent.includes('\r\n') ? '\r\n' : '\n';

// Step 1: Baseline check before edit
console.log('Step 1: Baseline verification (before edit)');
const baselineCheck = execSync(
  `"${pythonExe}" -c "import os; os.environ['FLASK_DEBUG']='off'; from flask.helpers import get_debug_flag; print(get_debug_flag())"`,
  { cwd: flaskDir }
).toString().trim();
console.log(`  Baseline FLASK_DEBUG='off' -> ${baselineCheck}`);
assert.strictEqual(baselineCheck, 'True', 'Baseline must evaluate "off" to True before the edit');

// Step 2: Formulate the proposed edit for get_debug_flag
console.log('\nStep 2: Proposing edit for get_debug_flag');
const targetFunctionOld = [
  'def get_debug_flag() -> bool:',
  '    """Get whether debug mode should be enabled for the app, indicated by the',
  '    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.',
  '    """',
  '    val = os.environ.get("FLASK_DEBUG")',
  '    return bool(val and val.lower() not in {"0", "false", "no"})',
].join(eol);

const targetFunctionNew = [
  'def get_debug_flag() -> bool:',
  '    """Get whether debug mode should be enabled for the app, indicated by the',
  '    :envvar:`FLASK_DEBUG` environment variable. The default is ``False``.',
  '    The values "0", "false", "no", "off", and "n" are treated as false.',
  '    """',
  '    val = os.environ.get("FLASK_DEBUG")',
  '    return bool(val and val.lower() not in {"0", "false", "no", "off", "n"})',
].join(eol);

assert.ok(originalContent.includes(targetFunctionOld), 'Original content must contain target function');
const proposedContent = originalContent.replace(targetFunctionOld, targetFunctionNew);

// Step 3: Compute Myers diff hunks with 0 context
const fileDiff = computeFileDiff('src/flask/helpers.py', originalContent, proposedContent, 'Task A: get_debug_flag');
console.log(`  Computed hunks count: ${fileDiff.hunks.length}`);
// Hunk 0: Docstring update; Hunk 1: Implementation update
assert.ok(fileDiff.hunks.length >= 1, 'Task A must produce at least 1 reviewable hunk');

fileDiff.hunks.forEach((h, idx) => {
  console.log(`  Hunk ${idx + 1}: oldStart=${h.oldStart}, oldLinesCount=${h.oldLinesCount}`);
  console.log(`    Original: ${JSON.stringify(h.originalLines)}`);
  console.log(`    Proposed: ${JSON.stringify(h.proposedLines)}`);
  acceptHunk(fileDiff, h.id);
});

// Step 4: Assemble applied content after accepting hunks
console.log('\nStep 3: Assembling applied content');
const appliedContent = assembleContent(fileDiff, 'applied');
assert.strictEqual(appliedContent, proposedContent);

// Step 5: Write to disk and run live Python checks
console.log('\nStep 4: Writing applied change to disk for verification');
fs.writeFileSync(helpersPath, appliedContent, 'utf-8');

try {
  // Test FLASK_DEBUG='off' -> False
  const checkOff = execSync(
    `"${pythonExe}" -c "import os; os.environ['FLASK_DEBUG']='off'; from flask.helpers import get_debug_flag; print(get_debug_flag())"`,
    { cwd: flaskDir }
  ).toString().trim();
  console.log(`  ✓ FLASK_DEBUG='off' -> ${checkOff}`);
  assert.strictEqual(checkOff, 'False', 'get_debug_flag() must return False for "off"');

  // Test FLASK_DEBUG='OFF' (case-insensitive) -> False
  const checkOffCaps = execSync(
    `"${pythonExe}" -c "import os; os.environ['FLASK_DEBUG']='OFF'; from flask.helpers import get_debug_flag; print(get_debug_flag())"`,
    { cwd: flaskDir }
  ).toString().trim();
  console.log(`  ✓ FLASK_DEBUG='OFF' -> ${checkOffCaps}`);
  assert.strictEqual(checkOffCaps, 'False', 'get_debug_flag() must return False for "OFF"');

  // Test FLASK_DEBUG='n' -> False
  const checkN = execSync(
    `"${pythonExe}" -c "import os; os.environ['FLASK_DEBUG']='n'; from flask.helpers import get_debug_flag; print(get_debug_flag())"`,
    { cwd: flaskDir }
  ).toString().trim();
  console.log(`  ✓ FLASK_DEBUG='n' -> ${checkN}`);
  assert.strictEqual(checkN, 'False', 'get_debug_flag() must return False for "n"');

  // Test FLASK_DEBUG='N' (case-insensitive) -> False
  const checkNCaps = execSync(
    `"${pythonExe}" -c "import os; os.environ['FLASK_DEBUG']='N'; from flask.helpers import get_debug_flag; print(get_debug_flag())"`,
    { cwd: flaskDir }
  ).toString().trim();
  console.log(`  ✓ FLASK_DEBUG='N' -> ${checkNCaps}`);
  assert.strictEqual(checkNCaps, 'False', 'get_debug_flag() must return False for "N"');

  // Test FLASK_DEBUG='1' -> True
  const checkOne = execSync(
    `"${pythonExe}" -c "import os; os.environ['FLASK_DEBUG']='1'; from flask.helpers import get_debug_flag; print(get_debug_flag())"`,
    { cwd: flaskDir }
  ).toString().trim();
  console.log(`  ✓ FLASK_DEBUG='1' -> ${checkOne}`);
  assert.strictEqual(checkOne, 'True', 'get_debug_flag() must return True for "1"');

  // Run pytest on test_cli.py
  console.log('\nStep 5: Running pytest tests/test_cli.py -q for regression check');
  const pytestRes = execSync(
    `"${pytestExe}" tests/test_cli.py -q`,
    { cwd: flaskDir }
  ).toString().trim();
  console.log(`  ✓ Pytest output: ${pytestRes}`);
  assert.ok(pytestRes.includes('passed'), 'All CLI tests must continue passing');

} finally {
  // Step 6: Rollback and ensure clean working tree
  console.log('\nStep 6: Rolling back changes and checking git status');
  fs.writeFileSync(helpersPath, originalContent, 'utf-8');
  const gitStatus = execSync('git status --porcelain', { cwd: flaskDir }).toString().trim();
  assert.strictEqual(gitStatus, '', 'Flask working tree must be 100% clean after rollback');
  console.log('  ✓ Flask git status clean after rollback.');
}

console.log('\nTask A (Inline Edit on pallets/flask) verified successfully! 🚀\n');
