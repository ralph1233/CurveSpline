import React from 'react';
import {Skia, Canvas, Path, Line, vec} from '@shopify/react-native-skia';
import {Dimensions, SafeAreaView} from 'react-native';
import {
  GestureDetector,
  GestureHandlerRootView,
  Gesture,
} from 'react-native-gesture-handler';
import {useSharedValue, useDerivedValue} from 'react-native-reanimated';

const SIZE = Dimensions.get('window').width - 32;
const HIT_RADIUS = 28;
const MAX_POINTS = 10; // 2 fixed endpoints + 8 user-placed

type Pt = {x: number; y: number};

// Start with only the two locked endpoints
const INITIAL_POINTS: Pt[] = [
  {x: 0, y: SIZE},
  {x: SIZE, y: 0},
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

// Static grid at 25%, 50%, 75%
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

  const curvePath = useDerivedValue(() => {
    'worklet';
    return buildSplinePath(points.value);
  });

  // Filled circles for draggable intermediate points
  const movableDotsPath = useDerivedValue(() => {
    'worklet';
    const p = Skia.Path.Make();
    const pts = points.value;
    for (let i = 1; i < pts.length - 1; i++) {
      p.addCircle(pts[i].x, pts[i].y, 6);
    }
    return p;
  });

  // Outlined circles for the locked endpoints
  const endpointDotsPath = useDerivedValue(() => {
    'worklet';
    const p = Skia.Path.Make();
    const pts = points.value;
    p.addCircle(pts[0].x, pts[0].y, 6);
    p.addCircle(pts[pts.length - 1].x, pts[pts.length - 1].y, 6);
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
      const pts = points.value;
      const minX = pts[i - 1].x;
      const maxX = pts[i + 1].x;
      const clampY = (v: number) => Math.max(0, Math.min(SIZE, v));
      const next = [...pts];
      next[i] = {
        x: Math.max(minX, Math.min(maxX, dragStart.value.x + e.translationX)),
        y: clampY(dragStart.value.y + e.translationY),
      };
      points.value = next;
    })
    .onFinalize(() => {
      'worklet';
      activeIdx.value = -1;
    });

  const tapGesture = Gesture.Tap().onEnd(e => {
    'worklet';
    if (points.value.length >= MAX_POINTS) {
      return;
    }
    // Don't add if tapping near an existing point
    const nearExisting = points.value.some(
      pt => Math.sqrt((pt.x - e.x) ** 2 + (pt.y - e.y) ** 2) < HIT_RADIUS,
    );
    if (nearExisting) {
      return;
    }
    const newPt = {x: e.x, y: e.y};
    const pts = points.value;
    let insertAt = pts.length - 1;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].x > newPt.x) {
        insertAt = i;
        break;
      }
    }
    points.value = [...pts.slice(0, insertAt), newPt, ...pts.slice(insertAt)];
  });

  const longPressGesture = Gesture.LongPress().onStart(e => {
    'worklet';
    const last = points.value.length - 1;
    let hitIdx = -1;
    points.value.forEach((pt, i) => {
      if (i === 0 || i === last) {
        return;
      }
      if (Math.sqrt((pt.x - e.x) ** 2 + (pt.y - e.y) ** 2) < HIT_RADIUS) {
        hitIdx = i;
      }
    });
    if (hitIdx >= 0) {
      const pts = points.value;
      points.value = [...pts.slice(0, hitIdx), ...pts.slice(hitIdx + 1)];
    }
  });

  const gesture = Gesture.Exclusive(panGesture, longPressGesture, tapGesture);

  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <SafeAreaView
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
        }}>
        <GestureDetector gesture={gesture}>
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
            {/* Draggable points — filled white */}
            <Path path={movableDotsPath} color="white" />
            {/* Fixed endpoints — outlined white */}
            <Path path={endpointDotsPath} color="white" />
          </Canvas>
        </GestureDetector>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

export default App;
