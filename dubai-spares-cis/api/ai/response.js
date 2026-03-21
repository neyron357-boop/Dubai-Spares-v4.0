export const aiSuccess = (task, result) => ({
  ok: true,
  task,
  result,
  error: null,
});

export const aiFailure = (task, error) => ({
  ok: false,
  task,
  result: null,
  error: error instanceof Error ? error.message : String(error || 'Unknown AI error'),
});
