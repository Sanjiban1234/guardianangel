// mobile/src/safety/override/__tests__/useOverride.test.ts
import * as fs from 'fs';
import * as path from 'path';

/**
 * Test: useOverride must call the LATEST version of dependency functions,
 * not stale closures from the initial render.
 *
 * This test catches the bug where OverrideController was created once via useRef
 * and never updated when deps changed, causing it to call stale versions of
 * getCountdownState/cancelCountdown/resetCrashDetector indefinitely.
 *
 * The fix: use useMemo keyed on the three dep functions, recreating the
 * controller when any of them change.
 *
 * NOTE: This test verifies the implementation via source code inspection.
 * Full re-render behavior testing requires @testing-library/react-hooks or
 * integration tests once App.tsx wiring is complete.
 */
describe('useOverride stale closure fix', () => {
  it('implementation uses useMemo, not useRef (static verification)', () => {
    // Read the actual source file
    const sourceFile = path.join(__dirname, '../useOverride.ts');
    const source = fs.readFileSync(sourceFile, 'utf-8');

    // The fixed implementation should use useMemo
    expect(source).toContain('useMemo');
    expect(source).toContain('import { useMemo }');

    // The broken implementation used useRef
    expect(source).not.toContain('useRef');

    // Verify the dependency array includes all three functions
    expect(source).toContain('deps.getCountdownState');
    expect(source).toContain('deps.cancelCountdown');
    expect(source).toContain('deps.resetCrashDetector');
  });
});
