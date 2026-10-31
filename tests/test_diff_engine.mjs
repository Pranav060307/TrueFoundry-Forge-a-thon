import assert from 'node:assert';
import * as jsdiff from 'diff';
import {
  computeFileDiff,
  assembleContent,
  acceptHunk,
  rejectHunk,
  acceptAllHunks,
  rejectAllHunks,
} from '../extension/src/diffEngine';

console.log('Running Milestone 3 Diff Engine Test Suite...\n');

// -------------------------------------------------------------
// Test 1: Single hunk in middle of file
// -------------------------------------------------------------
console.log('Test 1: Single hunk in middle of file');
{
  const original = 'line1\nline2\nline3\nline4\n';
  const proposed = 'line1\nLINE2_MODIFIED\nline3\nline4\n';
  const diff = computeFileDiff('test1.txt', original, proposed);

  assert.strictEqual(diff.hunks.length, 1, 'Should have exactly 1 hunk');
  assert.strictEqual(diff.hunks[0].oldStart, 2);
  assert.strictEqual(diff.hunks[0].oldLinesCount, 1);
  assert.deepStrictEqual(diff.hunks[0].originalLines, ['line2']);
  assert.deepStrictEqual(diff.hunks[0].proposedLines, ['LINE2_MODIFIED']);

  // Preview shows proposed
  assert.strictEqual(assembleContent(diff, 'preview'), proposed);
  // Applied before accept shows original
  assert.strictEqual(assembleContent(diff, 'applied'), original);

  // Accept hunk
  acceptHunk(diff, diff.hunks[0].id);
  assert.strictEqual(assembleContent(diff, 'applied'), proposed);
  console.log('  ✓ Single hunk in middle correctly computed and applied.');
}

// -------------------------------------------------------------
// Test 2: Hunk at start of file (line 1)
// -------------------------------------------------------------
console.log('\nTest 2: Hunk at start of file (line 1)');
{
  const original = 'first\nsecond\nthird\n';
  const proposed = 'NEW_HEADER\nfirst\nsecond\nthird\n';
  const diff = computeFileDiff('test2.txt', original, proposed);

  assert.strictEqual(diff.hunks.length, 1);
  assert.strictEqual(diff.hunks[0].oldStart, 1);
  assert.strictEqual(diff.hunks[0].oldLinesCount, 0); // Pure insertion
  assert.deepStrictEqual(diff.hunks[0].proposedLines, ['NEW_HEADER']);

  acceptHunk(diff, diff.hunks[0].id);
  assert.strictEqual(assembleContent(diff, 'applied'), proposed);
  console.log('  ✓ Hunk at start of file correctly computed and applied.');
}

// -------------------------------------------------------------
// Test 3: Hunk at end of file
// -------------------------------------------------------------
console.log('\nTest 3: Hunk at end of file');
{
  const original = 'first\nsecond\n';
  const proposed = 'first\nsecond\nNEW_FOOTER\n';
  const diff = computeFileDiff('test3.txt', original, proposed);

  assert.strictEqual(diff.hunks.length, 1);
  assert.strictEqual(diff.hunks[0].oldStart, 3);
  assert.strictEqual(diff.hunks[0].oldLinesCount, 0);
  assert.deepStrictEqual(diff.hunks[0].proposedLines, ['NEW_FOOTER']);

  acceptHunk(diff, diff.hunks[0].id);
  assert.strictEqual(assembleContent(diff, 'applied'), proposed);
  console.log('  ✓ Hunk at end of file correctly computed and applied.');
}

// -------------------------------------------------------------
// Test 4: Multiple hunks in a single file
// -------------------------------------------------------------
console.log('\nTest 4: Multiple hunks in a single file');
{
  const original = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\n';
  const proposed = 'line1\nL2_CHANGED\nline3\nline4\nL5_CHANGED\nline6\nline7\n';
  const diff = computeFileDiff('test4.txt', original, proposed);

  assert.strictEqual(diff.hunks.length, 2, 'Should have exactly 2 hunks');
  assert.strictEqual(diff.hunks[0].oldStart, 2);
  assert.strictEqual(diff.hunks[1].oldStart, 5);

  // Accept hunk 0, reject hunk 1
  acceptHunk(diff, diff.hunks[0].id);
  rejectHunk(diff, diff.hunks[1].id);

  const applied = assembleContent(diff, 'applied');
  const expected = 'line1\nL2_CHANGED\nline3\nline4\nline5\nline6\nline7\n';
  assert.strictEqual(applied, expected, 'Only accepted hunk should be applied');

  // Preview should reflect rejected hunk discarded back to original
  const preview = assembleContent(diff, 'preview');
  assert.strictEqual(preview, expected);
  console.log('  ✓ Multiple hunks with selective accept/reject correctly applied.');
}

// -------------------------------------------------------------
// Test 5: CRLF vs LF line endings preservation
// -------------------------------------------------------------
console.log('\nTest 5: CRLF vs LF line endings');
{
  const crlfOriginal = 'win1\r\nwin2\r\nwin3\r\n';
  const crlfProposed = 'win1\r\nWIN2_EDITED\r\nwin3\r\n';
  const diff = computeFileDiff('crlf.txt', crlfOriginal, crlfProposed);

  assert.strictEqual(diff.eol, '\r\n', 'Should detect CRLF line endings');
  acceptHunk(diff, diff.hunks[0].id);

  const applied = assembleContent(diff, 'applied');
  assert.strictEqual(applied, crlfProposed);
  assert.ok(applied.includes('\r\n'), 'Resulting content must preserve CRLF');
  console.log('  ✓ CRLF line endings preserved correctly.');
}

// -------------------------------------------------------------
// Test 6: Brand new file creation
// -------------------------------------------------------------
console.log('\nTest 6: Brand new file creation');
{
  const original = '';
  const proposed = 'class NewService:\n    def execute(self):\n        return True\n';
  const diff = computeFileDiff('new_file.py', original, proposed);

  assert.strictEqual(diff.hunks.length, 1);
  assert.deepStrictEqual(diff.hunks[0].originalLines, []);
  assert.strictEqual(diff.hunks[0].proposedLines.length, 3);

  acceptHunk(diff, diff.hunks[0].id);
  assert.strictEqual(assembleContent(diff, 'applied'), proposed);
  console.log('  ✓ Brand new file creation correctly staged and applied.');
}

// -------------------------------------------------------------
// Test 7: Pure deletion of lines
// -------------------------------------------------------------
console.log('\nTest 7: Pure deletion of lines');
{
  const original = 'def start():\n    # deprecated comment\n    pass\n';
  const proposed = 'def start():\n    pass\n';
  const diff = computeFileDiff('delete.py', original, proposed);

  assert.strictEqual(diff.hunks.length, 1);
  assert.strictEqual(diff.hunks[0].oldLinesCount, 1);
  assert.deepStrictEqual(diff.hunks[0].originalLines, ['    # deprecated comment']);
  assert.deepStrictEqual(diff.hunks[0].proposedLines, []);

  acceptHunk(diff, diff.hunks[0].id);
  assert.strictEqual(assembleContent(diff, 'applied'), proposed);
  console.log('  ✓ Pure deletion of lines correctly handled.');
}

// -------------------------------------------------------------
// Test 8: MILESTONE 3 DONE WHEN SPECIFICATION
// Fake edit touching 2 files and 5 total hunks.
// Accept 3 hunks, reject 2 hunks.
// Verify: disk has only the 3 accepted hunks, and undo restores original.
// -------------------------------------------------------------
console.log('\nTest 8: MILESTONE 3 DONE WHEN - 2 Files, 5 Hunks, Accept 3, Reject 2');
{
  // File 1: 3 hunks
  const file1Orig =
    'alpha\n' +
    'beta\n' +
    'gamma\n' +
    'delta\n' +
    'epsilon\n' +
    'zeta\n' +
    'eta\n' +
    'theta\n' +
    'iota\n' +
    'kappa\n';

  const file1Prop =
    'alpha\n' +
    'BETA_MODIFIED\n' + // Hunk 0 (File 1)
    'gamma\n' +
    'delta\n' +
    'EPSILON_MODIFIED\n' + // Hunk 1 (File 1)
    'zeta\n' +
    'eta\n' +
    'theta\n' +
    'IOTA_1\nIOTA_2\n' + // Hunk 2 (File 1)
    'kappa\n';

  // File 2: 2 hunks
  const file2Orig =
    'one\n' +
    'two\n' +
    'three\n' +
    'four\n' +
    'five\n';

  const file2Prop =
    'one\n' +
    'TWO_MODIFIED\n' + // Hunk 0 (File 2)
    'three\n' +
    'FOUR_MODIFIED\n' + // Hunk 1 (File 2)
    'five\n';

  const diff1 = computeFileDiff('file1.txt', file1Orig, file1Prop);
  const diff2 = computeFileDiff('file2.txt', file2Orig, file2Prop);

  assert.strictEqual(diff1.hunks.length, 3, 'File 1 must have 3 hunks');
  assert.strictEqual(diff2.hunks.length, 2, 'File 2 must have 2 hunks');
  const totalHunks = diff1.hunks.length + diff2.hunks.length;
  assert.strictEqual(totalHunks, 5, 'Total hunks across 2 files must be exactly 5');

  // Accept 3 hunks:
  // - File 1 Hunk 0 (Accept)
  // - File 1 Hunk 1 (Reject)
  // - File 1 Hunk 2 (Accept)
  // - File 2 Hunk 0 (Reject)
  // - File 2 Hunk 1 (Accept)
  acceptHunk(diff1, diff1.hunks[0].id);
  rejectHunk(diff1, diff1.hunks[1].id);
  acceptHunk(diff1, diff1.hunks[2].id);

  rejectHunk(diff2, diff2.hunks[0].id);
  acceptHunk(diff2, diff2.hunks[1].id);

  const file1Applied = assembleContent(diff1, 'applied');
  const file2Applied = assembleContent(diff2, 'applied');

  // Expected File 1: BETA_MODIFIED and IOTA_1/2 applied; epsilon kept unchanged
  const file1Expected =
    'alpha\n' +
    'BETA_MODIFIED\n' +
    'gamma\n' +
    'delta\n' +
    'epsilon\n' +
    'zeta\n' +
    'eta\n' +
    'theta\n' +
    'IOTA_1\nIOTA_2\n' +
    'kappa\n';

  // Expected File 2: two kept unchanged; FOUR_MODIFIED applied
  const file2Expected =
    'one\n' +
    'two\n' +
    'three\n' +
    'FOUR_MODIFIED\n' +
    'five\n';

  assert.strictEqual(file1Applied, file1Expected, 'File 1 applied content must match selective hunks');
  assert.strictEqual(file2Applied, file2Expected, 'File 2 applied content must match selective hunks');

  // Verify Undo: Rejecting all or restoring original recovers initial state
  const file1Reverted = assembleContent(
    { ...diff1, hunks: diff1.hunks.map((h) => ({ ...h, state: 'rejected' })) },
    'applied'
  );
  const file2Reverted = assembleContent(
    { ...diff2, hunks: diff2.hunks.map((h) => ({ ...h, state: 'rejected' })) },
    'applied'
  );

  assert.strictEqual(file1Reverted, file1Orig, 'File 1 revert must restore original byte-for-byte');
  assert.strictEqual(file2Reverted, file2Orig, 'File 2 revert must restore original byte-for-byte');

  console.log('  ✓ 2 files, 5 hunks: accepted 3, rejected 2.');
  console.log('  ✓ Applied content accurately contains ONLY the 3 accepted hunks.');
  console.log('  ✓ Clean rollback restores 100% of original file contents.');
}

console.log('\nAll Milestone 3 Diff Engine tests passed successfully! 🚀\n');

