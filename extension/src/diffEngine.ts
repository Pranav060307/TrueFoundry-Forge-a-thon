import * as jsdiff from 'diff';

export interface DiffHunk {
  id: string;
  filePath: string;
  oldStart: number; // 1-based start line in original
  oldLinesCount: number;
  newStart: number; // 1-based start line in proposed
  newLinesCount: number;
  originalLines: string[];
  proposedLines: string[];
  state: 'pending' | 'accepted' | 'rejected';
}

export interface FileDiff {
  filePath: string;
  originalContent: string;
  proposedContent: string;
  reason?: string;
  hunks: DiffHunk[];
  eol: '\n' | '\r\n';
  proposedEndsWithNewline: boolean;
}

/**
 * Computes individual isolated diff hunks between original and proposed content
 * using Myers diff algorithm with 0-line context so each contiguous modification
 * is a distinct reviewable hunk.
 */
export function computeFileDiff(
  filePath: string,
  originalContent: string,
  proposedContent: string,
  reason?: string
): FileDiff {
  const normPath = filePath.replace(/\\/g, '/');
  const eol: '\n' | '\r\n' = originalContent.includes('\r\n') ? '\r\n' : '\n';
  const proposedEndsWithNewline = proposedContent.endsWith('\n') || proposedContent.endsWith('\r\n');

  // Compute structured patch with 0 context lines to isolate hunks
  const patch = jsdiff.structuredPatch(normPath, normPath, originalContent, proposedContent, '', '', {
    context: 0,
  });

  const hunks: DiffHunk[] = patch.hunks.map((h, index) => {
    const origLines: string[] = [];
    const propLines: string[] = [];

    for (const line of h.lines) {
      // Strip leading +/- sign and any trailing carriage return \r from raw diff line
      const cleanLine = line.slice(1).replace(/\r$/, '');
      if (line.startsWith('-')) {
        origLines.push(cleanLine);
      } else if (line.startsWith('+')) {
        propLines.push(cleanLine);
      }
    }

    return {
      id: `hunk_${index}`,
      filePath: normPath,
      oldStart: h.oldStart,
      oldLinesCount: h.oldLines,
      newStart: h.newStart,
      newLinesCount: h.newLines,
      originalLines: origLines,
      proposedLines: propLines,
      state: 'pending',
    };
  });

  return {
    filePath: normPath,
    originalContent,
    proposedContent,
    reason,
    hunks,
    eol,
    proposedEndsWithNewline,
  };
}

/**
 * Reassembles document content based on hunk review states:
 * - 'preview': pending and accepted hunks use proposedLines; rejected hunks use originalLines.
 * - 'applied': only accepted hunks use proposedLines; pending and rejected hunks retain originalLines.
 */
export function assembleContent(fileDiff: FileDiff, mode: 'preview' | 'applied'): string {
  const { originalContent, hunks, eol, proposedEndsWithNewline } = fileDiff;
  const endsWithNewline =
    originalContent === ''
      ? proposedEndsWithNewline
      : originalContent.endsWith('\n') || originalContent.endsWith('\r\n');

  const lines = originalContent === '' ? [] : originalContent.split(/\r?\n/);
  if (originalContent !== '' && endsWithNewline && lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const result: string[] = [];
  let curr = 0;

  for (const hunk of hunks) {
    const startIdx = hunk.oldStart <= 0 ? 0 : hunk.oldStart - 1;

    // Output unchanged lines before this hunk
    while (curr < startIdx && curr < lines.length) {
      result.push(lines[curr]);
      curr++;
    }

    const useProposed = mode === 'applied' ? hunk.state === 'accepted' : hunk.state !== 'rejected';
    const linesToUse = useProposed ? hunk.proposedLines : hunk.originalLines;
    result.push(...linesToUse);

    curr = startIdx + hunk.oldLinesCount;
  }

  // Output remaining unchanged lines
  while (curr < lines.length) {
    result.push(lines[curr]);
    curr++;
  }

  if (result.length === 0) {
    return '';
  }

  return result.join(eol) + (endsWithNewline ? eol : '');
}

/**
 * Marks a specific hunk as accepted.
 */
export function acceptHunk(fileDiff: FileDiff, hunkId: string): boolean {
  const hunk = fileDiff.hunks.find((h) => h.id === hunkId);
  if (!hunk) return false;
  hunk.state = 'accepted';
  return true;
}

/**
 * Marks a specific hunk as rejected.
 */
export function rejectHunk(fileDiff: FileDiff, hunkId: string): boolean {
  const hunk = fileDiff.hunks.find((h) => h.id === hunkId);
  if (!hunk) return false;
  hunk.state = 'rejected';
  return true;
}

/**
 * Marks all pending hunks as accepted.
 */
export function acceptAllHunks(fileDiff: FileDiff): void {
  for (const hunk of fileDiff.hunks) {
    if (hunk.state === 'pending') {
      hunk.state = 'accepted';
    }
  }
}

/**
 * Marks all pending hunks as rejected.
 */
export function rejectAllHunks(fileDiff: FileDiff): void {
  for (const hunk of fileDiff.hunks) {
    if (hunk.state === 'pending') {
      hunk.state = 'rejected';
    }
  }
}
