import { encodeToMatrix } from 'datamatrix-svg-ts';
import Svg, { Rect } from 'react-native-svg';

export function DataMatrixCode({ value, size = 160 }: { value: string; size?: number }) {
  const { matrix, width, height } = encodeToMatrix(value);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${width} ${height}`}>
      <Rect x={0} y={0} width={width} height={height} fill="#FFFFFF" />
      {matrix.flatMap((row, y) =>
        row.map((cell, x) =>
          cell ? <Rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#000000" /> : null,
        ),
      )}
    </Svg>
  );
}
