jest.mock('../useRideSummary', () => ({ useRideSummary: jest.fn() }));

import { RideSummaryScreen, formatDistance, formatDuration } from '../RideSummaryScreen';
import { useRideSummary } from '../useRideSummary';

const mockUseRideSummary = useRideSummary as jest.MockedFunction<typeof useRideSummary>;

const collectText = (node: unknown): string[] => {
  if (typeof node === 'string') return [node];
  if (!node || typeof node !== 'object') return [];
  const children = (node as { props?: { children?: unknown } }).props?.children;
  return Array.isArray(children) ? children.flatMap(collectText) : collectText(children);
};

const findNode = (node: unknown, text: string): { props: { onPress?: () => void; children?: unknown } } | undefined => {
  if (!node || typeof node !== 'object') return undefined;
  const typedNode = node as { props?: { onPress?: () => void; children?: unknown } };
  if (typedNode.props?.onPress && collectText(typedNode.props.children).includes(text)) {
    return typedNode as { props: { onPress?: () => void; children?: unknown } };
  }
  const children = typedNode.props?.children;
  return Array.isArray(children)
    ? children.map(child => findNode(child, text)).find(Boolean)
    : findNode(children, text);
};

describe('RideSummaryScreen formatting', () => {
  it('formats sub-kilometre distances as whole metres', () => {
    expect(formatDistance(22.488945)).toBe('22 m');
    expect(formatDistance(824.4)).toBe('824 m');
  });

  it('formats kilometre distances with no more than two decimal places', () => {
    expect(formatDistance(22488.945)).toBe('22.49 km');
  });

  it('formats seconds, minutes, and hours without raw milliseconds', () => {
    expect(formatDuration(48_000)).toBe('48 sec');
    expect(formatDuration(154_000)).toBe('2m 34s');
    expect(formatDuration(4_080_000)).toBe('1h 8m');
  });

  it('uses designed unavailable states without unsupported claims and preserves Done', () => {
    mockUseRideSummary.mockReturnValue({
      data: { room_id: 'room-1', group_code: 'GROUP1', user_id: 'rider-1', total_distance_meters: 22488.945, actual_duration_ms: 120000 },
      loading: false,
      error: null,
      retry: jest.fn(),
    });
    const onReturnToPortal = jest.fn();
    const tree = RideSummaryScreen({ groupCode: 'GROUP1', authToken: 'token', apiBaseUrl: 'https://api.example', onReturnToPortal });
    const text = collectText(tree).join(' ');

    expect(text).toContain('Pace Benchmark');
    expect(text).toContain('Unavailable');
    expect(text).toContain('Speed Chart Unavailable');
    expect(text).not.toMatch(/RIDE COMPLETED SAFELY|All riders arrived safely|45 km\/h/);

    findNode(tree, 'DONE')?.props.onPress?.();
    expect(onReturnToPortal).toHaveBeenCalledTimes(1);
  });
});
