export type VectorPoint = { x: number; y: number };

export type AffineMatrix = readonly [number, number, number, number, number, number];

export type VectorSegment =
  | { type: 'line'; from: VectorPoint; to: VectorPoint }
  | { type: 'quadratic'; from: VectorPoint; control: VectorPoint; to: VectorPoint }
  | { type: 'cubic'; from: VectorPoint; control1: VectorPoint; control2: VectorPoint; to: VectorPoint }
  | { type: 'arc'; from: VectorPoint; to: VectorPoint; rx: number; ry: number; rotation: number; largeArc: boolean; sweep: boolean };

export type VectorPath = {
  id: string;
  closed: boolean;
  segments: VectorSegment[];
  transform: AffineMatrix;
  strokeWidth?: number;
};

export type VectorDocument = {
  width: number;
  height: number;
  paths: VectorPath[];
  warnings: string[];
  nodeCount: number;
  segmentCount: number;
};

export type VectorParseLimits = {
  maxNodes: number;
  maxDepth: number;
  maxPathCommands: number;
  maxSegments: number;
};

export const SVG_LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxNodes: 25_000,
  maxDepth: 128,
  maxPathCommands: 100_000,
  maxSegments: 100_000,
  maxFlattenedPoints: 1_000_000,
} as const;

export const DEFAULT_VECTOR_PARSE_LIMITS: VectorParseLimits = {
  maxNodes: SVG_LIMITS.maxNodes,
  maxDepth: SVG_LIMITS.maxDepth,
  maxPathCommands: SVG_LIMITS.maxPathCommands,
  maxSegments: SVG_LIMITS.maxSegments,
};
