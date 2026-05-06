import React, {useRef, useState} from 'react';
import {
  Skia,
  Canvas,
  Path,
  Circle,
  Line,
  vec,
} from '@shopify/react-native-skia';
import {PanResponder, SafeAreaView} from 'react-native';

const SIZE = 256;
const HIT_RADIUS = 28;

type Pt = {x: number; y: number};

// Identity mapping: (input=0, output=0) → (input=255, output=255)
// In canvas coords: bottom-left (0, SIZE) to top-right (SIZE, 0)
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
  const [points, setPoints] = useState<Pt[]>(INITIAL_POINTS);

  // Ref so PanResponder closures always see the latest points
  const pointsRef = useRef(points);
  pointsRef.current = points;

  const activeIdx = useRef(-1);
  const dragStart = useRef<Pt>({x: 0, y: 0});

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: evt => {
        const {locationX, locationY} = evt.nativeEvent;
        let bestIdx = -1;
        let bestDist = HIT_RADIUS;
        pointsRef.current.forEach((pt, i) => {
          const d = Math.hypot(pt.x - locationX, pt.y - locationY);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        });
        activeIdx.current = bestIdx;
        if (bestIdx >= 0) {
          dragStart.current = {
            ...pointsRef.current[bestIdx],
          };
        }
      },
      onPanResponderMove: (_, gs) => {
        const i = activeIdx.current;
        if (i < 0) {
          return;
        }
        const clamp = (v: number) => Math.max(0, Math.min(SIZE, v));
        setPoints(prev => {
          const next = [...prev];
          next[i] = {
            x: clamp(dragStart.current.x + gs.dx),
            y: clamp(dragStart.current.y + gs.dy),
          };
          return next;
        });
      },
      onPanResponderRelease: () => {
        activeIdx.current = -1;
      },
    }),
  ).current;

  const curvePath = buildSplinePath(points);
  console.log('Re rendering');

  return (
    <SafeAreaView
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
      }}>
      <Canvas
        style={{
          width: SIZE,
          height: SIZE,
          backgroundColor: '#1a1a1a',
        }}
        {...panResponder.panHandlers}>
        {/* Grid lines */}
        <Path
          path={gridPath}
          color="rgba(255,255,255,0.08)"
          style="stroke"
          strokeWidth={0.5}
        />
        {/* Identity diagonal reference */}
        <Line
          p1={vec(0, SIZE)}
          p2={vec(SIZE, 0)}
          color="rgba(255,255,255,0.2)"
          strokeWidth={1}
        />
        {/* Red channel curve */}
        <Path
          path={curvePath}
          color="#ff3b3b"
          style="stroke"
          strokeWidth={2}
          strokeCap="round"
          strokeJoin="round"
        />
        {/* Draggable control point handles */}
        {points.map((pt, i) => (
          <Circle key={i} cx={pt.x} cy={pt.y} r={6} color="white" />
        ))}
      </Canvas>
    </SafeAreaView>
  );
}

export default App;
