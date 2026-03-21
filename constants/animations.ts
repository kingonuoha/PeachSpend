export const Durations = { 
  instant: 100, 
  fast: 200, 
  normal: 300, 
  slow: 500, 
  verySlow: 800 
} as const;

export const Springs = { 
  gentle: { damping: 20, stiffness: 120 }, 
  bouncy: { damping: 14, stiffness: 180 }, 
  snappy: { damping: 28, stiffness: 300 } 
} as const;

export const staggerDelay = (i: number, base = 40) => i * base;
