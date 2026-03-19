export const orderPhotoPipeline = {
  stage: 'normalize-upload-compress',
  description: 'Handles image normalization/compression before order mutations are persisted or synced.'
} as const;
