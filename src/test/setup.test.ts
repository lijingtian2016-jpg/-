import { describe, expect, it } from 'vitest'

describe('test environment', () => {
  it('loads jsdom and jest-dom matchers', () => {
    expect(document.body).toBeInTheDocument()
  })
})
