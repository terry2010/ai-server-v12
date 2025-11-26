import type { WindowApi } from '../shared/window-api'

declare global {
  interface Window {
    api: WindowApi
  }
}

export {}
