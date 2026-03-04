import { BrowserWindow } from 'electron'

let _mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow): void {
  _mainWindow = win
}

export function getMainWindow(): BrowserWindow | null {
  return _mainWindow
}
