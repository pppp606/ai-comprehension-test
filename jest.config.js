module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js'],
  // Increase default timeout to reduce spurious timeouts in slow tests
  testTimeout: Number(process.env.JEST_TEST_TIMEOUT || 30000),
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transform: {
    '^.+\\.ts$': 'ts-jest'
  }
};
