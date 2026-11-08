/**
 * Stripe colour per line. TfL's API doesn't provide colours, so they live here; an unknown line falls
 * back to a neutral grey. The stripe is decoration only: the line name is always shown as text.
 */
const COLOURS: Record<string, string> = {
  bakerloo: '#a45a2a',
  central: '#da291c',
  circle: '#ffcd00',
  district: '#007a33',
  'hammersmith-city': '#e89cae',
  jubilee: '#7c878e',
  metropolitan: '#840b55',
  northern: '#000000',
  piccadilly: '#10069f',
  victoria: '#00a3e0',
  'waterloo-city': '#6eceb2',
  elizabeth: '#6950a1',
  dlr: '#00afad',
  tram: '#5fb526',
  'london-cable-car': '#e21836',
  liberty: '#5d6061',
  lioness: '#faa61a',
  mildmay: '#0077ad',
  suffragette: '#5bbd72',
  weaver: '#823a62',
  windrush: '#ed1b00',
};

export const lineColour = (lineId: string) => COLOURS[lineId] ?? '#8a9099';
