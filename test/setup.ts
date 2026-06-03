import '@testing-library/jest-dom/vitest'

// jsdom lacks ResizeObserver; Radix primitives (e.g. Slider) measure size on
// mount and throw without it. A no-op shim is enough for component tests.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
}
