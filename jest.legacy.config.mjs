export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: { target: 'ES2022', esModuleInterop: true, module: 'ESNext', experimentalDecorators: true, emitDecoratorMetadata: true, isolatedModules: true } }] },
  moduleNameMapper: { '^(?:\\.\\./)+src/(.*)\\.js$': '<rootDir>/dist/$1', '^(\\.{1,2}/.*)\\.js$': '$1' },
  verbose: false,
};
