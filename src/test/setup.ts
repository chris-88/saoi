import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * Testing Library registers its own cleanup through a global `afterEach`, which only exists
 * when Vitest runs with `globals: true`. This project imports `describe`/`it`/`expect`
 * explicitly, so the automatic hook never fires and rendered DOM would accumulate across
 * tests in a file. Register it by hand.
 */
afterEach(cleanup)

/**
 * jsdom has no `ResizeObserver`, and Radix measures a checkbox's box with one the moment it
 * mounts. The landing page gained a form with a checkbox on it (§44) and every test that
 * rendered the page fell over in a layout effect. A stub that never calls back is the honest
 * version here: nothing in these tests is laid out, so there is nothing to observe.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub
}
