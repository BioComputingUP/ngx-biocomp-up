export interface Schema {
  // Define amino-acid code to color mapping
  [key: string]: { background: string; color: string };
}

// Define ClustalX color scheme
export const ClustalX: Schema = {
  A: { background: '#FFBF00', color: '#000000' },
  R: { background: '#FF0000', color: '#FFFFFF' },
  N: { background: '#00FFFF', color: '#000000' },
  D: { background: '#0000FF', color: '#FFFFFF' },
  C: { background: '#FFFF00', color: '#000000' },
  Q: { background: '#00FF00', color: '#000000' },
  E: { background: '#FF00FF', color: '#FFFFFF' },
  G: { background: '#808080', color: '#FFFFFF' },
  H: { background: '#008000', color: '#FFFFFF' },
  I: { background: '#FFA500', color: '#000000' },
  L: { background: '#FFA500', color: '#000000' },
  K: { background: '#FF0000', color: '#FFFFFF' },
  M: { background: '#FFA500', color: '#000000' },
  F: { background: '#FFA500', color: '#000000' },
  P: { background: '#800080', color: '#FFFFFF' },
  S: { background: '#00FF00', color: '#000000' },
  T: { background: '#00FF00', color: '#000000' },
  W: { background: '#FFA500', color: '#000000' },
  Y: { background: '#FFA500', color: '#000000' },
  V: { background: '#FFA500', color: '#000000' },
  B: { background: '#FFA500', color: '#000000' },
  Z: { background: '#FFA500', color: '#000000' },
  X: { background: '#FFA500', color: '#000000' },
  '-': { background: '#FFFFFF', color: '#000000' },
};
