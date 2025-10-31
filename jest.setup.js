// Speed up sample code waits during tests
process.env.AI_COMP_TEST_FAST = process.env.AI_COMP_TEST_FAST || '1';

// Optionally allow overriding per run
if (!process.env.JEST_TEST_TIMEOUT && typeof jest !== 'undefined') {
  // Keep in sync with jest.config.js default
  jest.setTimeout(30000);
}

