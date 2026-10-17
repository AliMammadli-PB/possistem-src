/**
 * Label sizes on screen in millimetres, inches or printer dots. The profile
 * keeps millimetres (paper) and whole dots (layout); these convert for display
 * and back. 203 DPI heads address 8 dots/mm, 300 DPI heads 12 dots/mm.
 */
export type LabelUnit = 'mm' | 'in' | 'dot';
export const MM_PER_INCH = 25.4;
export const dotsPerMm = (dpi: number) => (dpi === 300 ? 12 : 8);
/** Paper length in mm → the unit shown (dots for paper read as mm). */
export const mmToUnit = (mm: number, unit: LabelUnit) => (unit === 'in' ? mm / MM_PER_INCH : mm);
export const unitToMm = (value: number, unit: LabelUnit) => (unit === 'in' ? value * MM_PER_INCH : value);
/** A layout length in dots → the unit shown. */
export const dotsToUnit = (dots: number, dpi: number, unit: LabelUnit) => (unit === 'dot' ? dots : mmToUnit(dots / dotsPerMm(dpi), unit));
/** A typed layout length → whole printer dots. */
export const unitToDots = (value: number, dpi: number, unit: LabelUnit) => Math.round(unit === 'dot' ? value : unitToMm(value, unit) * dotsPerMm(dpi));
/** Display precision: one dot is 0.125 mm / ~0.005 in at 203 DPI. */
export const roundUnit = (value: number, unit: LabelUnit) => (unit === 'dot' ? Math.round(value) : unit === 'in' ? Math.round(value * 1000) / 1000 : Math.round(value * 100) / 100);
export const unitStep = (unit: LabelUnit) => (unit === 'dot' ? 1 : unit === 'in' ? 0.005 : 0.1);
/** Move-step choices for the arrows. */
export const moveSteps = (unit: LabelUnit) => (unit === 'dot' ? [1, 5, 10, 20] : unit === 'in' ? [0.01, 0.02, 0.05, 0.1] : [0.25, 0.5, 1, 2]);
/** Paper sizes are never shown in dots: dots fall back to millimetres there. */
export const paperUnit = (unit: LabelUnit): 'mm' | 'in' => (unit === 'in' ? 'in' : 'mm');
