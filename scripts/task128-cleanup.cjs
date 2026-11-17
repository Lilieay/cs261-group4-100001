function errorDetails(error) {
  return {name: error.name, message: error.message};
}

async function finishRun({fixtures, remove, verifyBaseline, originalError}) {
  const failedFixtures = [];
  for (const fixture of [...fixtures].reverse()) {
    const {kind, id} = fixture;
    try {
      const response = await remove(fixture);
      const expected = kind === 'guide' ? 200 : 204;
      if (response.status !== expected) {
        failedFixtures.push({kind, id, status: response.status,
          error: response.data?.error ?? response.data?.detail ?? null});
      }
    } catch (error) {
      failedFixtures.push({kind, id, status: null, error: errorDetails(error)});
    }
  }

  let baselineError = null;
  try {
    await verifyBaseline();
  } catch (error) {
    baselineError = errorDetails(error);
  }
  return {
    testError: originalError ? errorDetails(originalError) : null,
    cleanup: {
      status: failedFixtures.length || baselineError ? 'Fail' : 'Pass',
      failedFixtures,
      baselineError
    }
  };
}

module.exports = {finishRun};
