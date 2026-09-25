/**
 * Future live scale (serial/USB). P0 uses barcode PLU rules in core only.
 * Implement connect/readWeight when vendor docs + device are available.
 */
export class ScaleProviderStub {
  async connect() {
    return { ok: false, reason: 'ScaleProvider not configured' };
  }

  async readWeightGrams() {
    throw new Error('ScaleProvider stub — use scale barcode path');
  }

  async disconnect() {
    return { ok: true };
  }
}
