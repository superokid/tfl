/**
 * Corrections to automatic reference choices (ADR-005/007). Every entry needs a reason; the README
 * lists them. Keep this empty unless the generator demonstrably picks wrong.
 */
export interface Override {
  /** Use these check stations (NaPTAN ids) instead of the automatic pick. */
  checkStations?: [string, string];
  /** Never judge this line: TfL publishes no predictions for it. */
  statusOnly?: boolean;
  reason: string;
}

export const OVERRIDES: Record<string, Override> = {
  'london-cable-car': {
    statusOnly: true,
    reason: 'TfL publishes no predictions for the cable car: line arrivals 404, station arrivals always [].',
  },
};
