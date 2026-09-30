import { expect, it } from 'vitest';
import * as contracts from './index.js';
it('defines explicit correction previews and distinct immutable provenance contracts', () => {
  expect(contracts).toHaveProperty('previewCorrectionRequestSchema');
  expect(contracts).toHaveProperty('sourceCorrectionSchema');
  expect(contracts).toHaveProperty('updateCorrectionRequestSchema');
});
