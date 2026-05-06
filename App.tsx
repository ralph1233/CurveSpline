import React from 'react';
import {
  Skia,
  Canvas,
  Path,
  Line,
  vec,
  Shader,
  ImageShader,
  Fill,
  useImage,
  ColorType,
  AlphaType,
} from '@shopify/react-native-skia';
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

type Pt = {
  x: number;
  y: number;
};

// Start with only the two locked endpoints
const INITIAL_POINTS: Pt[] = [
  {
    x: 0,
    y: SIZE,
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
    const clamp = (v: number) => Math.max(0, Math.min(SIZE, v));
    const cp1x = clamp(prev1.x + (curr.x - prev2.x) / 6);
    const cp1y = clamp(prev1.y + (curr.y - prev2.y) / 6);
    const cp2x = clamp(curr.x - (next.x - prev1.x) / 6);
    const cp2y = clamp(curr.y - (next.y - prev1.y) / 6);
    p.cubicTo(cp1x, cp1y, cp2x, cp2y, curr.x, curr.y);
  }
  return p;
}

// Parametric sampling: evaluate each Bezier segment at STEPS t values,
// then interpolate to produce a 256-value lookup table.
// lut[inputR] = outputR  (both 0..255)
function buildLUT(pts: Pt[]): number[] {
  'worklet';
  const STEPS = 100;

  // Dense (x, y) samples in canvas space — approximately sorted by x
  const xs: number[] = [];
  const ys: number[] = [];

  for (let i = 1; i < pts.length; i++) {
    const prev2 = pts[Math.max(i - 2, 0)];
    const prev1 = pts[i - 1];
    const curr = pts[i];
    const next = pts[Math.min(i + 1, pts.length - 1)];
    const clamp = (v: number) => Math.max(0, Math.min(SIZE, v));

    const cp1x = clamp(prev1.x + (curr.x - prev2.x) / 6);
    const cp1y = clamp(prev1.y + (curr.y - prev2.y) / 6);
    const cp2x = clamp(curr.x - (next.x - prev1.x) / 6);
    const cp2y = clamp(curr.y - (next.y - prev1.y) / 6);

    for (let step = 0; step <= STEPS; step++) {
      const t = step / STEPS;
      const mt = 1 - t;
      xs.push(
        mt * mt * mt * prev1.x +
          3 * mt * mt * t * cp1x +
          3 * mt * t * t * cp2x +
          t * t * t * curr.x,
      );
      ys.push(
        mt * mt * mt * prev1.y +
          3 * mt * mt * t * cp1y +
          3 * mt * t * t * cp2y +
          t * t * t * curr.y,
      );
    }
  }

  // Single-pass interpolation: for each input 0..255 find the bracketing samples
  const lut: number[] = new Array(256);
  let si = 0;
  for (let input = 0; input <= 255; input++) {
    const canvasX = (input / 255) * SIZE;
    while (si < xs.length - 2 && xs[si + 1] <= canvasX) {
      si++;
    }
    const lo = {
      x: xs[si],
      y: ys[si],
    };
    const hi = {
      x: xs[si + 1] ?? xs[si],
      y: ys[si + 1] ?? ys[si],
    };
    const t = hi.x === lo.x ? 0 : (canvasX - lo.x) / (hi.x - lo.x);
    const canvasY = lo.y + t * (hi.y - lo.y);
    // y=0 → output 255 (top), y=SIZE → output 0 (bottom)
    lut[input] = Math.round(((SIZE - canvasY) / SIZE) * 255);
  }

  return lut;
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

const shader = Skia.RuntimeEffect.Make(`
  uniform shader image;
  uniform shader lutImage;
  
   half4 main(float2 coord) {
    half4 color = image.eval(coord);

    // color.r is 0..1 in Skia shaders, so multiply by 255 to get the LUT x position
    half4 lutColor = lutImage.eval(float2(clamp(color.r * 255.0, 0.0, 255.0), 0.5));

    return vec4(clamp(lutColor.r, 0.0, 1.0), color.g, color.b, color.a);
   }
  `)!;

function App() {
  const image = useImage(require('./image.png'));
  const points = useSharedValue<Pt[]>(INITIAL_POINTS);
  const activeIdx = useSharedValue(-1);
  const dragStart = useSharedValue<Pt>({x: 0, y: 0});

  const curvePath = useDerivedValue(() => {
    'worklet';
    return buildSplinePath(points.value);
  });

  const lut = useDerivedValue(() => {
    'worklet';
    return buildLUT(points.value);
  });

  const lutImage = useDerivedValue(() => {
    'worklet';

    const pixels = new Uint8Array(256 * 1 * 4);
    for (let x = 0; x < 256; x++) {
      pixels[x * 4] = lut.value[x];
      pixels[x * 4 + 1] = 0;
      pixels[x * 4 + 2] = 0;
      pixels[x * 4 + 3] = 255;
    }

    return Skia.Image.MakeImage(
      {
        width: 256,
        height: 1,
        colorType: ColorType.RGBA_8888,
        alphaType: AlphaType.Opaque,
      },
      Skia.Data.fromBytes(pixels),
      256 * 4,
    );
  });

  // All control points — filled white
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
      points.value.forEach((pt, i) => {
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
      const last = pts.length - 1;
      const isFirst = i === 0;
      const isLast = i === last;
      const minX = isFirst ? 0 : pts[i - 1].x;
      const maxX = isLast ? SIZE : pts[i + 1].x;
      const clampY = (v: number) => Math.max(0, Math.min(SIZE, v));
      const next = [...pts];
      next[i] = {
        // Endpoints stay pinned to their x; only y moves
        x:
          isFirst || isLast
            ? pts[i].x
            : Math.max(
                minX,
                Math.min(maxX, dragStart.value.x + e.translationX),
              ),
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
    <GestureHandlerRootView
      style={{
        flex: 1,
      }}>
      <SafeAreaView
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          gap: 20,
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
            {/* All control points — filled white */}
            <Path path={dotsPath} color="white" />
          </Canvas>
        </GestureDetector>

        <Canvas
          style={{
            width: 300,
            height: 300,
          }}>
          <Fill>
            <Shader source={shader}>
              <ImageShader
                image={image}
                x={0}
                y={0}
                width={300}
                height={300}
                fit="cover"
              />
              <ImageShader
                image={lutImage}
                x={0}
                y={0}
                width={256}
                height={1}
                fit="cover"
              />
            </Shader>
          </Fill>
        </Canvas>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

export default App;
