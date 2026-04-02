import '@testing-library/jest-dom'

// ResizeObserver polyfill for jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// matchMedia polyfill for Mantine in jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// scrollIntoView is not implemented in jsdom
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  writable: true,
  value: () => {},
});
