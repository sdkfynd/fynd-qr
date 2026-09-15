export const BODY_SHAPES = [
  { id: 'square', label: 'Square' }, { id: 'rounded', label: 'Rounded' },
  { id: 'dots', label: 'Dots' }, { id: 'diamond', label: 'Diamond' },
  { id: 'horizontal', label: 'Horizontal' }, { id: 'vertical', label: 'Vertical' },
  { id: 'connected', label: 'Connected' }, { id: 'leaf', label: 'Leaf' },
] as const;
export const FRAME_SHAPES = [
  { id: 'square', label: 'Square' }, { id: 'rounded', label: 'Rounded' },
  { id: 'soft', label: 'Soft' }, { id: 'bottom-round', label: 'Bottom round' },
  { id: 'leaf', label: 'Leaf' }, { id: 'diagonal', label: 'Diagonal' },
  { id: 'octagon', label: 'Octagon' }, { id: 'top-round', label: 'Top round' },
] as const;
export const BALL_SHAPES = [
  { id: 'square', label: 'Square' }, { id: 'rounded', label: 'Rounded' },
  { id: 'top-round', label: 'Top round' }, { id: 'soft', label: 'Soft' },
  { id: 'leaf', label: 'Leaf' }, { id: 'octagon', label: 'Octagon' },
  { id: 'diagonal', label: 'Diagonal' }, { id: 'shield', label: 'Shield' },
] as const;
export type BodyShape = typeof BODY_SHAPES[number]['id'];
export type EyeFrame = typeof FRAME_SHAPES[number]['id'];
export type EyeBall = typeof BALL_SHAPES[number]['id'];
export type ShapeCategory = 'pattern' | 'eyeFrame' | 'eyeBall';
type Corners = [number, number, number, number];

function roundedPath(x: number, y: number, size: number, radii: Corners): string {
  const [a, b, c, d] = radii;
  return `M${x+a} ${y}H${x+size-b}Q${x+size} ${y} ${x+size} ${y+b}V${y+size-c}Q${x+size} ${y+size} ${x+size-c} ${y+size}H${x+d}Q${x} ${y+size} ${x} ${y+size-d}V${y+a}Q${x} ${y} ${x+a} ${y}Z`;
}
function cutPath(x: number, y: number, size: number, cut: number): string {
  return `M${x+cut} ${y}H${x+size-cut}L${x+size} ${y+cut}V${y+size-cut}L${x+size-cut} ${y+size}H${x+cut}L${x} ${y+size-cut}V${y+cut}Z`;
}
function frameCorners(shape: EyeFrame): Corners {
  switch (shape) {
    case 'rounded': return [.75,.75,.75,.75];
    case 'soft': return [1.5,1.5,1.5,1.5];
    case 'bottom-round': return [0,0,2,2];
    case 'leaf': return [1.6,0,1.6,1.6];
    case 'diagonal': return [1.8,0,1.8,0];
    case 'top-round': return [2,2,0,0];
    default: return [0, 0, 0, 0];
  }
}
export function renderEyeFrame(shape: EyeFrame, x = 0, y = 0): string {
  const corners = frameCorners(shape);
  const outside = shape === 'octagon' ? cutPath(x, y, 7, .65) : roundedPath(x, y, 7, corners);
  const inside = shape === 'octagon' ? cutPath(x+1, y+1, 5, .2) : roundedPath(x+1, y+1, 5, corners.map(r => r*.2) as Corners);
  return `<path fill-rule="evenodd" d="${outside}${inside}"/>`;
}
export function renderEyeBall(shape: EyeBall, x = 0, y = 0): string {
  if (shape === 'octagon') return `<path d="${cutPath(x, y, 3, .3)}"/>`;
  const radii: Corners = shape === 'rounded' ? [.35,.35,.35,.35] : shape === 'leaf' ? [.65,0,.65,.65]
    : shape === 'soft' ? [.65,.65,.65,.65] : shape === 'diagonal' ? [.75,0,.75,0]
    : shape === 'shield' ? [.1,.1,.85,.85] : shape === 'top-round' ? [.85,.85,.1,.1] : [0,0,0,0];
  return `<path d="${roundedPath(x,y,3,radii)}"/>`;
}

/** isDataDark excludes reserved modules; connected shapes never merge into structural cells. */
export function renderBody(shape: BodyShape, size: number, isDataDark: (row: number, col: number) => boolean, offset = 4): string {
  const dark = (r: number, c: number) => r >= 0 && c >= 0 && r < size && c < size && isDataDark(r,c);
  const parts: string[] = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    if (!dark(row,col)) continue;
    const x = col+offset, y = row+offset;
    if (shape === 'horizontal' || shape === 'vertical') {
      const horizontal = shape === 'horizontal';
      if (dark(row-(horizontal?0:1),col-(horizontal?1:0))) continue;
      let length = 1;
      while (dark(row+(horizontal?0:length),col+(horizontal?length:0))) length++;
      parts.push(`<rect x="${x+(horizontal?0:.04)}" y="${y+(horizontal?.04:0)}" width="${horizontal?length:.92}" height="${horizontal?.92:length}" rx=".46"/>`);
    } else if (shape === 'dots') parts.push(`<circle cx="${x+.5}" cy="${y+.5}" r=".47"/>`);
    else if (shape === 'diamond') parts.push(`<path d="M${x+.5} ${y}l.5 .5-.5 .5-.5-.5Z"/>`);
    else if (shape === 'rounded') parts.push(`<rect x="${x}" y="${y}" width="1" height="1" rx=".28"/>`);
    else if (shape === 'leaf') parts.push(`<path d="${roundedPath(x,y,1,[.48,0,.48,0])}"/>`);
    else if (shape === 'connected') {
      const top = dark(row-1,col), right = dark(row,col+1), bottom = dark(row+1,col), left = dark(row,col-1);
      parts.push(`<path d="${roundedPath(x,y,1,[top||left?0:.45,top||right?0:.45,bottom||right?0:.45,bottom||left?0:.45])}"/>`);
    } else parts.push(`<path shape-rendering="crispEdges" d="M${x} ${y}h1v1h-1z"/>`);
  }
  return parts.join('');
}
export function shapeThumbnail(category: ShapeCategory, value: string): string {
  const sample = ['11011','10110','11101','01011','11010'];
  const art = category === 'pattern'
    ? renderBody(value as BodyShape, 5, (r,c) => sample[r][c] === '1', 1)
    : category === 'eyeFrame' ? renderEyeFrame(value as EyeFrame) : renderEyeBall(value as EyeBall);
  const viewBox = category === 'eyeBall' ? '-.3 -.3 3.6 3.6' : '-.3 -.3 7.6 7.6';
  return `<svg viewBox="${viewBox}" width="40" height="40" fill="currentColor" aria-hidden="true">${art}</svg>`;
}
