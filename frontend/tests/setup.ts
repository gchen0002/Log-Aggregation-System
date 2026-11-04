import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(() => cleanup());
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
});
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
global.requestAnimationFrame = (callback) =>
  setTimeout(() => callback(performance.now()), 16) as unknown as number;
global.cancelAnimationFrame = (handle) => clearTimeout(handle);
