const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron')
const path = require('path')
const fs = require('fs').promises

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false // 允许加载本地文件
    },
    show: false,
    titleBarStyle: 'default',
    resizable: true,
    minimizable: true,
    maximizable: true
  })

  // 窗口准备好后显示
  win.once('ready-to-show', () => {
    win.show()
  })

  win.loadFile('index.html')

  // 开发模式下打开开发者工具
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools()
  }

  // 添加快捷键支持
  win.webContents.on('before-input-event', (event, input) => {
    // F12 或 Cmd/Ctrl+Shift+I 打开开发者工具
    if (input.key === 'F12' || 
        (input.control && input.shift && input.key === 'I') ||
        (input.meta && input.shift && input.key === 'I')) {
      win.webContents.toggleDevTools()
    }
    
    // Cmd/Ctrl+R 刷新页面
    if ((input.control || input.meta) && input.key === 'r') {
      win.reload()
    }
    
    // Cmd/Ctrl+Shift+R 强制刷新
    if ((input.control || input.meta) && input.shift && input.key === 'R') {
      win.webContents.reloadIgnoringCache()
    }
  })

  return win
}

// 处理文件选择对话框
ipcMain.handle('open-file-dialog', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: '选择视频文件',
      properties: ['openFile'],
      filters: [
        {
          name: '视频文件',
          extensions: ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'flv', 'm4v', 'wmv', '3gp']
        },
        {
          name: '所有文件',
          extensions: ['*']
        }
      ]
    })

    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  } catch (error) {
    console.error('文件选择对话框错误:', error)
    return null
  }
})

// 读取打点文件
ipcMain.handle('read-annotation-file', async (event, filePath) => {
  try {
    const data = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    // 文件不存在或读取失败
    return null
  }
})

// 写入打点文件
ipcMain.handle('write-annotation-file', async (event, filePath, data) => {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return true
  } catch (error) {
    console.error('写入打点文件失败:', error)
    throw error
  }
})

// 创建应用程序菜单
const createMenu = () => {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开视频文件',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const mainWindow = BrowserWindow.getFocusedWindow()
            if (mainWindow) {
              mainWindow.webContents.send('menu-open-file')
            }
          }
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit()
          }
        }
      ]
    },
    {
      label: '查看',
      submenu: [
        {
          label: '刷新',
          accelerator: 'CmdOrCtrl+R',
          click: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.reload()
          }
        },
        {
          label: '强制刷新',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.reloadIgnoringCache()
          }
        },
        { type: 'separator' },
        {
          label: '实际大小',
          accelerator: 'CmdOrCtrl+0',
          click: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.setZoomLevel(0)
          }
        },
        {
          label: '放大',
          accelerator: 'CmdOrCtrl+Plus',
          click: (item, focusedWindow) => {
            if (focusedWindow) {
              const currentZoom = focusedWindow.webContents.getZoomLevel()
              focusedWindow.webContents.setZoomLevel(currentZoom + 0.5)
            }
          }
        },
        {
          label: '缩小',
          accelerator: 'CmdOrCtrl+-',
          click: (item, focusedWindow) => {
            if (focusedWindow) {
              const currentZoom = focusedWindow.webContents.getZoomLevel()
              focusedWindow.webContents.setZoomLevel(currentZoom - 0.5)
            }
          }
        },
        { type: 'separator' },
        {
          label: '全屏',
          accelerator: process.platform === 'darwin' ? 'Ctrl+Cmd+F' : 'F11',
          click: (item, focusedWindow) => {
            if (focusedWindow) {
              focusedWindow.setFullScreen(!focusedWindow.isFullScreen())
            }
          }
        }
      ]
    },
    {
      label: '开发',
      submenu: [
        {
          label: '开发者工具',
          accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Ctrl+Shift+I',
          click: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.toggleDevTools()
          }
        },
        {
          label: '控制台',
          accelerator: 'F12',
          click: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.toggleDevTools()
          }
        }
      ]
    }
  ]

  // macOS特殊处理
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        {
          label: '关于 ' + app.getName(),
          role: 'about'
        },
        { type: 'separator' },
        {
          label: '服务',
          role: 'services',
          submenu: []
        },
        { type: 'separator' },
        {
          label: '隐藏 ' + app.getName(),
          accelerator: 'Command+H',
          role: 'hide'
        },
        {
          label: '隐藏其他',
          accelerator: 'Command+Shift+H',
          role: 'hideothers'
        },
        {
          label: '显示全部',
          role: 'unhide'
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'Command+Q',
          click: () => app.quit()
        }
      ]
    })
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

app.whenReady().then(() => {
  createMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})