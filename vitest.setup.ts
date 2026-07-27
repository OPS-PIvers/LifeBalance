// Setup for the `jsdom` vitest project (see vite.config.ts). The `node`
// project loads vitest.setup.shared.ts directly instead, so it does not pay to
// import jest-dom — importing it is ~70ms per file, and no node-project suite
// uses its matchers. If you add a node-project test that needs
// toBeInTheDocument & friends, that test renders something, which means it
// belongs in the jsdom project anyway.
import './vitest.setup.shared';
import '@testing-library/jest-dom';
