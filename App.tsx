import React from 'react';
import {Skia, Canvas, Path, Line, vec} from '@shopify/react-native-skia';
import {SafeAreaView} from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
  Gesture,
} from 'react-native-gesture-handler';
import {useSharedValue, useDerivedValue} from 'react-native-reanimated';

const SIZE = 256;
const HIT_RADIUS = 28;

type Pt = {
  x: number;
  y: number;
};

const INITIAL_POINTS: Pt[] = [
  {
    x: 0,
    y: SIZE,
  },
  {
    x: SIZE * 0.25,
    y: SIZE * 0.75,
  },
  {
    x: SIZE * 0.5,
    y: SIZE * 0.5,
  },
  {
    x: SIZE * 0.75,
    y: SIZE * 0.25,
  },
  {
    x: SIZE,
    y: 0,
  },
];

function buildSplinePath(pts: Pt[]) {
  'worklet';
  const p = Skia.Path.Make();
  if (pts.length < 2) {
    return p;
  }
  p.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const prev2 = pts[Math.max(i - 2, 0)];
    const prev1 = pts[i - 1];
    const curr = pts[i];
    const next = pts[Math.min(i + 1, pts.length - 1)];
    const cp1x = prev1.x + (curr.x - prev2.x) / 6;
    const cp1y = prev1.y + (curr.y - prev2.y) / 6;
    const cp2x = curr.x - (next.x - prev1.x) / 6;
    const cp2y = curr.y - (next.y - prev1.y) / 6;
    p.cubicTo(cp1x, cp1y, cp2x, cp2y, curr.x, curr.y);
  }
  return p;
}

// Static — never changes
const gridPath = (() => {
  const p = Skia.Path.Make();
  [0.25, 0.5, 0.75].forEach(t => {
    const v = SIZE * t;
    p.moveTo(0, v);
    p.lineTo(SIZE, v);
    p.moveTo(v, 0);
    p.lineTo(v, SIZE);
  });
  return p;
})();

function App() {
  const points = useSharedValue<Pt[]>(INITIAL_POINTS);
  const activeIdx = useSharedValue(-1);
  const dragStart = useSharedValue<Pt>({x: 0, y: 0});

  // Rebuilt on UI thread whenever points change — no JS bridge involved
  const curvePath = useDerivedValue(() => {
    'worklet';
    return buildSplinePath(points.value);
  });

  const dotsPath = useDerivedValue(() => {
    'worklet';
    const p = Skia.Path.Make();
    points.value.forEach(pt => p.addCircle(pt.x, pt.y, 6));
    return p;
  });

  const panGesture = Gesture.Pan()
    .onBegin(e => {
      'worklet';
      let bestIdx = -1;
      let bestDist = HIT_RADIUS;
      const last = points.value.length - 1;
      points.value.forEach((pt, i) => {
        if (i === 0 || i === last) {
          return;
        }
        const d = Math.sqrt((pt.x - e.x) ** 2 + (pt.y - e.y) ** 2);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      });
      activeIdx.value = bestIdx;
      if (bestIdx >= 0) {
        dragStart.value = {...points.value[bestIdx]};
      }
    })
    .onUpdate(e => {
      'worklet';
      const i = activeIdx.value;
      if (i < 0) {
        return;
      }
      const clamp = (v: number) => Math.max(0, Math.min(SIZE, v));
      const next = [...points.value];
      next[i] = {
        x: clamp(dragStart.value.x + e.translationX),
        y: clamp(dragStart.value.y + e.translationY),
      };
      points.value = next;
    })
    .onEnd(() => {
      'worklet';
      activeIdx.value = -1;
    });

  console.log('Re rendering');

  return (
    <GestureHandlerRootView
      style={{
        flex: 1,
      }}>
      <SafeAreaView
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
        }}>
        <GestureDetector gesture={panGesture}>
          <Canvas
            style={{
              width: SIZE,
              height: SIZE,
              backgroundColor: '#1a1a1a',
            }}>
            <Path
              path={gridPath}
              color="rgba(255,255,255,0.08)"
              style="stroke"
              strokeWidth={0.5}
            />
            <Line
              p1={vec(0, SIZE)}
              p2={vec(SIZE, 0)}
              color="rgba(255,255,255,0.2)"
              strokeWidth={1}
            />
            <Path
              path={curvePath}
              color="#ff3b3b"
              style="stroke"
              strokeWidth={2}
              strokeCap="round"
              strokeJoin="round"
            />
            <Path path={dotsPath} color="white" />
          </Canvas>
        </GestureDetector>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

export default App;
