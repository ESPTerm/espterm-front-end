const EventEmitter = require('events')
const { parse2B } = require('../utils')
const { themes } = require('./themes')

const encodeAsCodePoint = i => String.fromCodePoint(i + (i >= 0xD800 ? 0x801 : 1))

class ANSIParser {
  constructor (handler) {
    this.reset()
    this.handler = handler
    this.joinChunks = true
  }
  reset () {
    this.currentSequence = 0
    this.sequence = ''
  }
  parseSequence (sequence) {
    if (sequence[0] === '[') {
      let type = sequence[sequence.length - 1]
      let content = sequence.substring(1, sequence.length - 1)

      let numbers = content ? content.split(';').map(i => +i.replace(/\D/g, '')) : []
      let numOr1 = numbers.length ? numbers[0] : 1
      if (type === 'H') {
        this.handler('set-cursor', (numbers[0] | 0) - 1, (numbers[1] | 0) - 1)
      } else if (type >= 'A' && type <= 'D') {
        this.handler(`move-cursor-${type <= 'B' ? 'y' : 'x'}`, ((type === 'B' || type === 'C') ? 1 : -1) * numOr1)
      } else if (type === 'E' || type === 'F') {
        this.handler('move-cursor-line', (type === 'E' ? 1 : -1) * numOr1)
      } else if (type === 'G') {
        this.handler('set-cursor-x', numOr1 - 1)
      } else if (type === 'J') {
        let number = numbers.length ? numbers[0] : 2
        if (number === 2) this.handler('clear')
      } else if (type === 'P') {
        this.handler('delete', numOr1)
      } else if (type === '@') {
        this.handler('insert-blanks', numOr1)
      } else if (type === 'q') this.handler('set-cursor-style', numOr1)
      else if (type === 'm') {
        if (!numbers.length) {
          this.handler('reset-style')
          return
        }
        let type
        while ((type = numbers.shift())) {
          if (type === 0) this.handler('reset-style')
          else if (type === 1) this.handler('add-attrs', 1 << 2) // bold
          else if (type === 2) this.handler('add-attrs', 1 << 9) // faint
          else if (type === 3) this.handler('add-attrs', 1 << 6) // italic
          else if (type === 4) this.handler('add-attrs', 1 << 3) // underline
          else if (type === 5 || type === 6) this.handler('add-attrs', 1 << 5) // blink
          else if (type === 7) this.handler('add-attrs', 1 << 4) // invert
          else if (type === 9) this.handler('add-attrs', 1 << 7) // strike
          else if (type === 20) this.handler('add-attrs', 1 << 10) // fraktur
          else if (type >= 30 && type <= 37) this.handler('set-color-fg', type % 10)
          else if (type >= 40 && type <= 47) this.handler('set-color-bg', type % 10)
          else if (type === 39) this.handler('reset-color-fg')
          else if (type === 49) this.handler('reset-color-bg')
          else if (type >= 90 && type <= 98) this.handler('set-color-fg', (type % 10) + 8)
          else if (type >= 100 && type <= 108) this.handler('set-color-bg', (type % 10) + 8)
          else if (type === 38 || type === 48) {
            let mode = numbers.shift()
            if (mode === 2) {
              let r = numbers.shift()
              let g = numbers.shift()
              let b = numbers.shift()
              let color = (r << 16 | g << 8 | b) + 256
              if (type === 38) this.handler('set-color-fg', color)
              if (type === 48) this.handler('set-color-bg', color)
            } else if (mode === 5) {
              let color = (numbers.shift() | 0) & 0xFF
              if (type === 38) this.handler('set-color-fg', color)
              if (type === 48) this.handler('set-color-bg', color)
            }
          }
        }
      } else if (type === 'h' || type === 'l') {
        if (content === '?25') {
          if (type === 'h') this.handler('show-cursor')
          else if (type === 'l') this.handler('hide-cursor')
        }
      }
    }
  }
  write (text) {
    for (let character of text.toString()) {
      let code = character.codePointAt(0)
      if (code === 0x1b) this.currentSequence = 1
      else if (this.currentSequence === 1 && character === '[') {
        this.currentSequence = 2
        this.sequence += '['
      } else if (this.currentSequence && character.match(/[\x40-\x7e]/)) {
        this.parseSequence(this.sequence + character)
        this.currentSequence = 0
        this.sequence = ''
      } else if (this.currentSequence > 1) this.sequence += character
      else if (this.currentSequence === 1) {
        // something something nothing
        this.currentSequence = 0
        this.handler('write', character)
      } else if (code < 0x03) this.handler('_null')
      else if (code === 0x03) this.handler('sigint')
      else if (code <= 0x06) this.handler('_null')
      else if (code === 0x07) this.handler('bell')
      else if (code === 0x08) this.handler('back')
      else if (code === 0x09) this.handler('tab')
      else if (code === 0x0a) this.handler('new-line')
      else if (code === 0x0d) this.handler('return')
      else if (code === 0x15) this.handler('delete-line')
      else if (code === 0x17) this.handler('delete-word')
      else this.handler('write', character)
    }
    if (!this.joinChunks) this.reset()
  }
}
const TERM_DEFAULT_STYLE = [0, 0, 0]

let getRainbowColor = t => {
  let r = Math.floor(Math.sin(t) * 2.5 + 2.5)
  let g = Math.floor(Math.sin(t + 2 / 3 * Math.PI) * 2.5 + 2.5)
  let b = Math.floor(Math.sin(t + 4 / 3 * Math.PI) * 2.5 + 2.5)
  return 16 + 36 * r + 6 * g + b
}

class ScrollingTerminal {
  constructor (screen) {
    this.width = 80
    this.height = 25
    this.termScreen = screen
    this.parser = new ANSIParser((...args) => this.handleParsed(...args))
    this.buttonLabels = []

    this.reset()

    this._lastLoad = Date.now()
    this.loadTimer()

    window.showPage()
  }
  reset () {
    this.style = TERM_DEFAULT_STYLE.slice()
    this.cursor = { x: 0, y: 0, style: 1, visible: true }
    this.trackMouse = false
    this.theme = 0
    this.defaultFG = 7
    this.defaultBG = 0
    this.rainbow = this.superRainbow = false
    this.parser.reset()
    this.clear()
  }
  clear () {
    this.screen = []
    for (let i = 0; i < this.width * this.height; i++) {
      this.screen.push([' ', this.style.slice()])
    }
  }
  scroll () {
    this.screen.splice(0, this.width)
    for (let i = 0; i < this.width; i++) {
      this.screen.push([' ', TERM_DEFAULT_STYLE.slice()])
    }
    this.cursor.y--
  }
  newLine () {
    this.cursor.y++
    if (this.cursor.y >= this.height) this.scroll()
  }
  writeChar (character) {
    this.screen[this.cursor.y * this.width + this.cursor.x] = [character, this.style.slice()]
    this.cursor.x++
    if (this.cursor.x >= this.width) {
      this.cursor.x = 0
      this.newLine()
    }
  }
  moveBack (n = 1) {
    for (let i = 0; i < n; i++) {
      this.cursor.x--
      if (this.cursor.x < 0) {
        if (this.cursor.y > 0) this.cursor.x = this.width - 1
        else this.cursor.x = 0
        this.cursor.y = Math.max(0, this.cursor.y - 1)
      }
    }
  }
  moveForward (n = 1) {
    for (let i = 0; i < n; i++) {
      this.cursor.x++
      if (this.cursor.x >= this.width) {
        this.cursor.x = 0
        this.cursor.y++
        if (this.cursor.y >= this.height) this.scroll()
      }
    }
  }
  deleteChar () {  // FIXME unused?
    this.moveBack()
    this.screen.splice((this.cursor.y + 1) * this.width, 0, [' ', TERM_DEFAULT_STYLE.slice()])
    this.screen.splice(this.cursor.y * this.width + this.cursor.x, 1)
  }
  deleteForward (n) {
    n = Math.min(this.width, n)
    for (let i = 0; i < n; i++) this.screen.splice((this.cursor.y + 1) * this.width, 0, [' ', TERM_DEFAULT_STYLE.slice()])
    this.screen.splice(this.cursor.y * this.width + this.cursor.x, n)
  }
  clampCursor () {
    if (this.cursor.x < 0) this.cursor.x = 0
    if (this.cursor.y < 0) this.cursor.y = 0
    if (this.cursor.x > this.width - 1) this.cursor.x = this.width - 1
    if (this.cursor.y > this.height - 1) this.cursor.y = this.height - 1
  }
  handleParsed (action, ...args) {
    if (action === 'write') {
      this.writeChar(args[0])
    } else if (action === 'delete') {
      this.deleteForward(args[0])
    } else if (action === 'insert-blanks') {
      this.insertBlanks(args[0]) // FIXME undefined?
    } else if (action === 'clear') {
      this.clear()
    } else if (action === 'bell') {
      this.termScreen.load('U\x01B')
    } else if (action === 'back') {
      this.moveBack()
    } else if (action === 'new-line') {
      this.newLine()
      this.cursor.x = 0
    } else if (action === 'return') {
      this.cursor.x = 0
    } else if (action === 'set-cursor') {
      this.cursor.x = args[1]
      this.cursor.y = args[0]
      this.clampCursor()
    } else if (action === 'move-cursor-y') {
      this.cursor.y += args[0]
      this.clampCursor()
    } else if (action === 'move-cursor-x') {
      this.cursor.x += args[0]
      this.clampCursor()
    } else if (action === 'move-cursor-line') {
      this.cursor.x = 0
      this.cursor.y += args[0]
      this.clampCursor()
    } else if (action === 'set-cursor-x') {
      this.cursor.x = args[0]
    } else if (action === 'set-cursor-style') {
      this.cursor.style = Math.max(0, Math.min(6, args[0]))
    } else if (action === 'reset-style') {
      this.style = TERM_DEFAULT_STYLE.slice()
    } else if (action === 'add-attrs') {
      this.style[2] |= args[0]
    } else if (action === 'set-color-fg') {
      this.style[0] = args[0]
      this.style[2] |= 1
    } else if (action === 'set-color-bg') {
      this.style[1] = args[0]
      this.style[2] |= 1 << 1
    } else if (action === 'reset-color-fg') {
      this.style[0] = 0
      if (this.style[2] & 1) this.style[2] ^= 1
    } else if (action === 'reset-color-bg') {
      this.style[1] = 0
      if (this.style[2] & (1 << 1)) this.style[2] ^= (1 << 1)
    } else if (action === 'hide-cursor') {
      this.cursor.visible = false
    } else if (action === 'show-cursor') {
      this.cursor.visible = true
    }
  }
  write (text) {
    this.parser.write(text)
  }
  getScreenOpts () {
    let data = 'O'
    data += encodeAsCodePoint(25)
    data += encodeAsCodePoint(80)
    data += encodeAsCodePoint(this.theme)
    data += this.encodeColor(this.defaultFG)
    data += this.encodeColor(this.defaultBG)
    let attributes = +this.cursor.visible
    attributes |= (3 << 5) * +this.trackMouse // track mouse controls both
    attributes |= 3 << 7 // buttons/links always visible
    attributes |= (this.cursor.style << 9)
    data += encodeAsCodePoint(attributes)
    return data
  }
  getButtons () {
    let data = 'B'
    data += encodeAsCodePoint(this.buttonLabels.length)
    data += this.buttonLabels.map(x => `\x01${x}\x01`).join('')
    return data
  }
  getTitle () {
    return 'TESPTerm Web UI Demo\x01'
  }
  getCursor () {
    let data = 'C'
    data += encodeAsCodePoint(this.cursor.y)
    data += encodeAsCodePoint(this.cursor.x)
    data += encodeAsCodePoint(0)
    return data
  }
  encodeColor (color) {
    if (color < 256) {
      return encodeAsCodePoint(color)
    } else {
      color -= 256
      return encodeAsCodePoint((color & 0xFFF) | 0x10000) + encodeAsCodePoint(color >> 12)
    }
  }
  serializeScreen () {
    let serialized = 'S'
    serialized += encodeAsCodePoint(0) + encodeAsCodePoint(0)
    serialized += encodeAsCodePoint(this.height) + encodeAsCodePoint(this.width)

    let lastStyle = [null, null, null]
    let index = 0
    for (let cell of this.screen) {
      let style = cell[1].slice()
      if (this.rainbow) {
        let x = index % this.width
        let y = Math.floor(index / this.width)
        // C instead of F in mask and 1 << 8 in attrs to change attr bits 1 and 2
        let t = (x + y) / 10 + Date.now() / 1000
        if (this.superRainbow) {
          t = (x * y + Date.now()) / 100 + Date.now() / 1000
        }
        style[0] = getRainbowColor(t)
        style[1] = 0
        if (this.superRainbow) style[1] = getRainbowColor(t / 10)
        style[2] = style[2] | 1
        if (!this.superRainbow && style[2] & (1 << 1)) style[2] ^= (1 << 1)
        index++
      }

      let foreground = style[0]
      let background = style[1]
      let attributes = style[2]
      let setForeground = foreground !== lastStyle[0]
      let setBackground = background !== lastStyle[1]
      let setAttributes = attributes !== lastStyle[2]

      if (setForeground && setBackground) {
        if (foreground < 256 && background < 256) {
          serialized += '\x03' + encodeAsCodePoint((background << 8) | foreground)
        } else {
          serialized += '\x05' + this.encodeColor(foreground)
          serialized += '\x06' + this.encodeColor(background)
        }
      } else if (setForeground) serialized += '\x05' + this.encodeColor(foreground)
      else if (setBackground) serialized += '\x06' + this.encodeColor(background)
      if (setAttributes) serialized += '\x04' + encodeAsCodePoint(attributes)
      lastStyle = style

      serialized += cell[0]
    }
    return serialized
  }
  getUpdate () {
    let topics = 0
    let topicData = []
    let screenOpts = this.getScreenOpts()
    let title = this.getTitle()
    let buttons = this.getButtons()
    let cursor = this.getCursor()
    let screen = this.serializeScreen()
    if (this._screenOpts !== screenOpts) {
      this._screenOpts = screenOpts
      topicData.push(screenOpts)
    }
    if (this._title !== title) {
      this._title = title
      topicData.push(title)
    }
    if (this._buttons !== buttons) {
      this._buttons = buttons
      topicData.push(buttons)
    }
    if (this._cursor !== cursor) {
      this._cursor = cursor
      topicData.push(cursor)
    }
    if (this._screen !== screen) {
      this._screen = screen
      topicData.push(screen)
    }
    if (!topicData.length) return ''
    return 'U' + encodeAsCodePoint(topics) + topicData.join('')
  }
  loadTimer () {
    clearInterval(this._loadTimer)
    this._loadTimer = setInterval(() => {
      let update = this.getUpdate()
      if (update) this.termScreen.load(update)
    }, 30)
  }
}

class Process extends EventEmitter {
  write (data) {
    this.emit('in', data)
  }
  destroy () {
    // death.
    this.emit('exit', 0)
  }
  run () {
    // noop
  }
}

let demoData = {
  buttons: [],
  mouseReceiver: null
}

let demoshIndex = {
  clear: class Clear extends Process {
    run () {
      this.emit('write', '\x1b[2J\x1b[1;1H')
      this.destroy()
    }
  },
  screenfetch: class Screenfetch extends Process {
    run () {
      let image = `
 ###.                          ESPTerm Demo
   '###.                       Hostname: ${window.location.hostname}
     '###.                     Shell: ESPTerm Demo Shell
       '###.                   Resolution: 80x25@${window.devicePixelRatio}x
         :###-
       .###'
     .###'
   .###'      ###############
 ###'         ###############
      `.split('\n').filter(line => line.trim())

      let chars = ''
      for (let y = 0; y < image.length; y++) {
        for (let x = 0; x < 80; x++) {
          if (image[y][x]) {
            chars += `\x1b[38;5;${getRainbowColor((x + y) / 10)}m${image[y][x]}`
          } else chars += ' '
        }
      }

      this.emit('write', '\r\n\x1b[?25l')
      let loop = () => {
        this.emit('write', chars.substr(0, 80))
        chars = chars.substr(80)
        if (chars.length) setTimeout(loop, 50)
        else {
          this.emit('write', '\r\n\x1b[?25h')
          this.destroy()
        }
      }
      loop()
    }
  },
  'local-echo': class LocalEcho extends Process {
    run (...args) {
      if (!args.includes('--suppress-note')) {
        this.emit('write', '\x1b[38;5;239mNote: not all terminal features are supported and may not work as expected in this demo\x1b[m\n')
      }
      this.emit('buttons', [
        {
          label: 'Exit',
          action (shell) {
            shell.write('\x03')
          }
        }
      ])
    }
    write (data) {
      this.emit('write', data)
    }
  },
  info: class Info extends Process {
    run (...args) {
      let fast = args.includes('--fast')
      this.showSplash().then(() => {
        this.printText(fast)
      })
    }
    showSplash () {
      let splash = `
              -#####- -###*..#####- ######-
              -#*    -#-    .## .##.  *#-
              -##### .-###*..#####-   *#-  -*##*- #*-#--#**#-*##-
              -#*        -#-.##.      *#-  *##@#* ##.  -#* *# .#*
              -#####--####- .##.      *#-  -*#@@- ##.  -#* *# .#*
      `.split('\n').filter(line => line.trim())
      let levels = {
        ' ': -231,
        '.': 4,
        '-': 8,
        '*': 17,
        '#': 24
      }
      let characters = {
        ' ': ' ',
        '.': '░',
        '-': '▒',
        '*': '▓',
        '#': '█'
      }
      for (let i in splash) {
        if (splash[i].length < 79) splash[i] += ' '.repeat(79 - splash[i].length)
      }
      this.emit('write', '\r\n'.repeat(splash.length + 1))
      this.emit('write', '\x1b[A'.repeat(splash.length))
      this.emit('write', '\x1b[?25l')

      let cursorX = 0
      let cursorY = 0
      let moveTo = (x, y) => {
        let moveX = x - cursorX
        let moveY = y - cursorY
        this.emit('write', `\x1b[${Math.abs(moveX)}${moveX > 0 ? 'C' : 'D'}`)
        this.emit('write', `\x1b[${Math.abs(moveY)}${moveY > 0 ? 'B' : 'A'}`)
        cursorX = x
        cursorY = y
      }
      let drawCell = (x, y) => {
        moveTo(x, y)
        if (splash[y][x] === '@') {
          this.emit('write', '\x1b[48;5;238m\x1b[38;5;255m▄\b')
        } else {
          let level = 231 + levels[splash[y][x]]
          let character = characters[splash[y][x]]
          this.emit('write', `\x1b[48;5;${level}m\x1b[38;5;${level}m${character}\b`)
        }
      }
      return new Promise((resolve, reject) => {
        const self = this
        let x = 13
        let cycles = 0
        let loop = function () {
          for (let y = 0; y < splash.length; y++) {
            let dx = x - y
            if (dx > 0) drawCell(dx, y)
          }

          if (++x < 70) {
            if (++cycles >= 3) {
              setTimeout(loop, 50)
              cycles = 0
            } else loop()
          } else {
            moveTo(0, splash.length)
            self.emit('write', '\x1b[m\x1b[?25h')
            resolve()
          }
        }
        loop()
      })
    }
    printText (fast = false) {
      // lots of printing
      let parts = [
        '',
        '  ESPTerm is a VT100-like terminal emulator running on the ESP8266 WiFi chip.',
        '',
        '  \x1b[93mThis is an online demo of the web user interface, simulating a simple ',
        '  terminal in your browser.\x1b[m',
        '',
        '  Type \x1b[92mls\x1b[m to list available commands.',
        '  Use the \x1b[94mlinks\x1b[m below this screen for a demo of the options and more info.',
        ''
      ]

      if (fast) {
        this.emit('write', parts.join('\r\n') + '\r\n')
        this.destroy()
      } else {
        const self = this
        let loop = function () {
          self.emit('write', parts.shift() + '\r\n')
          if (parts.length) setTimeout(loop, 17)
          else self.destroy()
        }
        loop()
      }
    }
  },
  colors: class PrintColors extends Process {
    run () {
      this.emit('write', '\r\n')
      let fgtext = 'foreground-color'
      this.emit('write', '    ')
      for (let i = 0; i < 16; i++) {
        this.emit('write', '\x1b[' + (i < 8 ? `3${i}` : `9${i - 8}`) + 'm')
        this.emit('write', fgtext[i] + ' ')
      }
      this.emit('write', '\r\n    ')
      for (let i = 0; i < 16; i++) {
        this.emit('write', '\x1b[' + (i < 8 ? `4${i}` : `10${i - 8}`) + 'm  ')
      }
      this.emit('write', '\x1b[m\r\n')
      for (let r = 0; r < 6; r++) {
        this.emit('write', '    ')
        for (let g = 0; g < 6; g++) {
          for (let b = 0; b < 6; b++) {
            this.emit('write', `\x1b[48;5;${16 + r * 36 + g * 6 + b}m  `)
          }
          this.emit('write', '\x1b[m')
        }
        this.emit('write', '\r\n')
      }
      this.emit('write', '    ')
      for (let g = 0; g < 24; g++) {
        this.emit('write', `\x1b[48;5;${232 + g}m  `)
      }
      this.emit('write', '\x1b[m\r\n\n')
      this.destroy()
    }
  },
  ls: class ListCommands extends Process {
    run () {
      this.emit('write', '\x1b[92mList of demo commands\x1b[m\r\n')
      for (let i in demoshIndex) {
        if (typeof demoshIndex[i] === 'string') continue
        this.emit('write', i + '\r\n')
      }
      this.destroy()
    }
  },
  theme: class SetTheme extends Process {
    constructor (shell) {
      super()
      this.shell = shell
    }
    run (...args) {
      let theme = +args[0] | 0
      const maxnum = themes.length
      if (!args.length || !Number.isFinite(theme) || theme < 0 || theme >= maxnum) {
        this.emit('write', `\x1b[31mUsage: theme [0–${maxnum - 1}]\n`)
        this.destroy()
        return
      }
      this.shell.terminal.theme = theme
      // HACK: reset drawn screen to prevent only partly redrawn screen
      this.shell.terminal.termScreen.drawnScreenFG = []
      this.emit('write', '')
      this.destroy()
    }
  },
  themes: class ShowThemes extends Process {
    constructor (shell) {
      super()
      this.shell = shell
      this.parser = new ANSIParser((...args) => this.handler(...args))
    }

    destroy () {
      this.shell.terminal.cursor.style = this.savedCursorStyle
      this.emit('write', '\n\n')
      super.destroy()
    }

    run (...args) {
      this.savedCursorStyle = this.shell.terminal.cursor.style
      this.shell.terminal.cursor.style = 3

      this.fgType = 0
      this.bgType = 0

      let get24FG = () => this.shell.terminal.defaultFG - 256
      let set24FG = v => { this.shell.terminal.defaultFG = v + 256 }
      let get24BG = () => this.shell.terminal.defaultBG - 256
      let set24BG = v => { this.shell.terminal.defaultBG = v + 256 }

      let make24Control = (label, index, getValue, setValue, type) => {
        index *= 4

        return {
          label,
          length: 1,
          getValue: () => (getValue() >> index) & 0xF,
          getDisplay: () => ((getValue() >> index) & 0xF).toString(16),
          setValue: value => {
            setValue((getValue() & (0xFFFFFF ^ (0xF << index))) | ((value & 0xF) << index))
          },
          shouldShow: () => this[type + 'Type'] === 1,
          parseValue: input => {
            return parseInt(input, 16) & 0xF
          },
          moveAfterInput: index !== 0
        }
      }

      this.controls = [
        {
          label: 'Theme: ',
          length: themes.length.toString().length,
          getValue: () => this.shell.terminal.theme,
          setValue: value => {
            let count = themes.length
            this.shell.terminal.theme = ((value % count) + count) % count
          }
        },
        {
          label: ' Default Foreground: ',
          length: 6,
          getValue: () => this.fgType,
          getDisplay: () => this.fgType === 0 ? '256' : '24-bit',
          setValue: value => {
            this.fgType = ((value % 2) + 2) % 2
          }
        },
        {
          label: ' ',
          length: 3,
          getValue: () => this.shell.terminal.defaultFG & 0xFF,
          setValue: value => {
            this.shell.terminal.defaultFG = value & 0xFF
          },
          shouldShow: () => this.fgType === 0,
          parseValue: input => parseInt(input, 16)
        },
        make24Control(' #', 5, get24FG, set24FG, 'fg'),
        make24Control('', 4, get24FG, set24FG, 'fg'),
        make24Control('', 3, get24FG, set24FG, 'fg'),
        make24Control('', 2, get24FG, set24FG, 'fg'),
        make24Control('', 1, get24FG, set24FG, 'fg'),
        make24Control('', 0, get24FG, set24FG, 'fg'),
        {
          label: ' Default Background: ',
          length: 6,
          getValue: () => this.bgType,
          getDisplay: () => this.bgType === 0 ? '256' : '24-bit',
          setValue: value => {
            this.bgType = ((value % 2) + 2) % 2
          }
        },
        {
          label: ' ',
          length: 3,
          getValue: () => this.shell.terminal.defaultBG & 0xFF,
          setValue: value => {
            this.shell.terminal.defaultBG = value & 0xFF
          },
          shouldShow: () => this.bgType === 0,
          parseValue: input => parseInt(input, 16)
        },
        make24Control(' #', 5, get24BG, set24BG, 'bg'),
        make24Control('', 4, get24BG, set24BG, 'bg'),
        make24Control('', 3, get24BG, set24BG, 'bg'),
        make24Control('', 2, get24BG, set24BG, 'bg'),
        make24Control('', 1, get24BG, set24BG, 'bg'),
        make24Control('', 0, get24BG, set24BG, 'bg')
      ]
      this.selection = 0

      this.emit('write', '\x1b[1mThemes\x1b[m\n\n\n\n\x1b[2A')

      this.render()
    }

    render () {
      this.emit('write', '\x1b[m\r')
      // no ^[2K implementation, here's a hack
      this.emit('write', ' '.repeat(this.shell.terminal.width - 1) + '\r')

      let index = 0
      let selectedX = 0
      for (let control of this.controls) {
        if (control.shouldShow && !control.shouldShow()) continue
        if (control.label) {
          this.emit('write', `\x1b[1m${control.label}\x1b[m`)
        }
        // TODO: colors
        this.emit('write', '\x1b[38;5;255m\x1b[48;5;16m')
        let value = control.getDisplay ? control.getDisplay() : control.getValue().toString()
        this.emit('write', (control.fill || ' ').repeat(Math.max(0, control.length - value.length)))
        this.emit('write', value.substr(0, control.length))
        this.emit('write', '\x1b[m')

        if (index === this.selection) {
          selectedX = this.shell.terminal.cursor.x - 1

          // draw arrows
          this.emit('write', '\x1b[m\x1b[D\x1b[A▲\x1b[D\x1b[2B▼\x1b[A')
        } else {
          // clear arrows if they were there
          this.emit('write', '\x1b[m\x1b[D\x1b[A \x1b[D\x1b[2B \x1b[A')
        }

        index++
      }

      this.shell.terminal.cursor.x = selectedX
    }

    write (data) {
      this.parser.write(data)
    }

    getControlCount () {
      let count = 0
      for (let control of this.controls) {
        if (control.shouldShow && !control.shouldShow()) continue
        count++
      }
      return count
    }

    getSelectedControl () {
      let selected = null
      let index = 0
      for (let control of this.controls) {
        if (control.shouldShow && !control.shouldShow()) continue
        if (index === this.selection) {
          selected = control
          break
        }
        index++
      }
      return selected
    }

    handler (action, ...args) {
      console.log(action, ...args)

      if (action === 'move-cursor-x') {
        this.selection += args[0]
        let count = this.getControlCount()
        this.selection = ((this.selection % count) + count) % count
      } else if (action === 'move-cursor-y') {
        let control = this.getSelectedControl()
        if (control) control.setValue(control.getValue() - args[0])
      } else if (action === 'write') {
        let control = this.getSelectedControl()
        if (control && control.parseValue) {
          let parsed = control.parseValue(args[0])
          if (Number.isFinite(parsed)) {
            control.setValue(parsed)
            if (control.moveAfterInput) {
              if (this.selection < this.getControlCount() - 1) this.selection++
            }
          }
        }
      }

      this.render()
    }
  },
  cursor: class SetCursor extends Process {
    run (...args) {
      let steady = args.includes('--steady')
      if (args.includes('block')) {
        this.emit('write', `\x1b[${2 * steady} q`)
      } else if (args.includes('line')) {
        this.emit('write', `\x1b[${3 + steady} q`)
      } else if (args.includes('bar') || args.includes('beam')) {
        this.emit('write', `\x1b[${5 + steady} q`)
      } else {
        this.emit('write', '\x1b[31mUsage: cursor [block|line|bar] [--steady]\r\n')
      }
      this.destroy()
    }
  },
  rainbow: class ToggleRainbow extends Process {
    constructor (shell, options = {}) {
      super()
      this.shell = shell
      this.su = options.su
      this.abort = false
    }
    write (data, newLine = true) {
      if (data === 'y') {
        this.shell.terminal.rainbow = !this.shell.terminal.rainbow
        this.shell.terminal.superRainbow = true
        demoData._didWarnRainbow = true
      } else {
        this.emit('write', data)
      }
      if (newLine) this.emit('write', '\x1b[0;32m\x1b[G\x1b[79PRainbow!\n')
      this.destroy()
    }
    run () {
      if (this.su && !this.shell.terminal.rainbow) {
        if (!demoData._didWarnRainbow) {
          this.emit('write', '\x1b[31;1mWarning: flashy colors. Continue? [y/N] ')
        } else {
          this.write('y', false)
        }
      } else {
        this.shell.terminal.rainbow = !this.shell.terminal.rainbow
        this.shell.terminal.superRainbow = false
        this.destroy()
      }
    }
    destroy () {
      this.abort = true
      super.destroy()
    }
  },
  mouse: class MouseDemo extends Process {
    constructor (shell) {
      super()
      this.shell = shell
    }
    run () {
      const self = this
      this.emit('buttons', [
        {
          label: 'Exit',
          action (shell) {
            shell.write('\x03')
          }
        },
        {
          label: 'Add Box',
          action () {
            self.boxes.push(self.generateRandomBox())
            self.render()
          }
        }
      ])

      this.shell.terminal.trackMouse = true
      demoData.mouseReceiver = this

      this.boxes = Array(3).fill(0).map(x => this.generateRandomBox())
      this.grabbedBox = null
      this.grabOffset = [0, 0]

      this.render()
    }
    render () {
      this.emit('write', '\x1b[m\x1b[2J\x1b[1;1H')
      this.emit('write', '\x1b[97m\x1b[1mMouse Demo\r\n\x1b[mMove boxes around or scroll their contents!')

      // draw boxes
      for (let box of this.boxes) {
        this.emit('write', `\x1b[${box.y + 1};${box.x + 1}H`)
        this.emit('write', `\x1b[m\x1b[48;2;${box.color.join(';')}m`)
        for (let y = box.y; y < box.y + box.height; y++) {
          let drawnX = 0
          for (let x = box.x; x < box.x + box.width; x++) {
            if (x < 0 || x >= this.shell.terminal.width - 1) continue
            if (y < 0 || y >= this.shell.terminal.height) continue
            drawnX++
            this.emit('write', box.content[y - box.y][x - box.x])
          }
          this.emit('write', '\x1b[D'.repeat(drawnX) + '\x1b[B')
        }
      }

      // move cursor to mouse
      if (this.mouse) {
        this.emit('write', `\x1b[${this.mouse.y + 1};${this.mouse.x + 1}H`)
      }
    }
    generateRandomBox () {
      let chars = 'abcdefghijklmnopqrstuvwxyz-*()!@#$%'
      let content = []
      let width = [5, 10, 15][Math.floor(Math.random() * 3)]
      let height = [4, 5, 6][Math.floor(Math.random() * 3)]

      for (let y = 0; y < height; y++) {
        content.push('')
        for (let x = 0; x < width; x++) {
          if (Math.random() > 0.6) {
            content[y] += chars[Math.floor(Math.random() * chars.length)]
          } else content[y] += ' '
        }
      }

      return {
        x: Math.floor(Math.random() * (this.shell.terminal.width - 1)) + 1,
        y: Math.floor(Math.random() * (this.shell.terminal.height - 1)) + 1,
        width,
        height,
        color: [Math.random(), Math.random(), Math.random()].map(x => Math.floor(x * 255)),
        content
      }
    }
    getBoxAt (x, y) {
      let boxes = this.boxes.slice().reverse() // top to bottom, like drawing order
      for (let box of boxes) {
        if (box.x <= x && box.x + box.width > x && box.y <= y && box.y + box.height > y) {
          return box
        }
      }
    }
    mouseMove (x, y) {
      this.mouse = { x, y }
      if (this.grabbedBox) {
        this.grabbedBox.x = x + this.grabOffset[0]
        this.grabbedBox.y = y + this.grabOffset[1]
      }
      this.render()
    }
    mouseDown (x, y, button) {
      if (button === 4) this.scrollInsideBox(this.getBoxAt(x, y), -1)
      else if (button === 5) this.scrollInsideBox(this.getBoxAt(x, y), 1)
      else {
        let box = this.getBoxAt(x, y)
        if (box) {
          this.grabbedBox = box
          this.grabOffset = [box.x - x, box.y - y]
          // move grabbed box to top of stack
          this.boxes.push(...this.boxes.splice(this.boxes.indexOf(box), 1))
        }
      }
      this.render()
    }
    mouseUp (x, y, button) {
      this.grabbedBox = null
    }
    scrollInsideBox (box, amount) {
      if (!box) return
      let content = box.content.slice()
      box.content = []
      for (let i = 0; i < content.length; i++) {
        box.content.push(content[((i + amount % content.length) + content.length) % content.length])
      }
    }
    destroy () {
      this.shell.terminal.write('\x1b[m\x1b[2J\x1b[1;1H')
      this.shell.terminal.trackMouse = false
      if (demoData.mouseReceiver === this) demoData.mouseReceiver = null
      super.destroy()
    }
  },
  sudo: class Sudo extends Process {
    constructor (shell) {
      super()
      this.shell = shell
      this.didDestroy = false
    }
    run (...args) {
      if (args.length === 0) {
        this.emit('write', '\x1b[31mUsage: sudo [command]\x1b[m\r\n')
        this.destroy()
      } else {
        let name = args.shift()
        if (this.shell.index[name]) {
          let Process = this.shell.index[name]
          if (Process instanceof Function) {
            let child = this.child = new Process(this.shell, { su: true })
            this.on('in', data => child.write(data))
            let write = data => this.emit('write', data)
            let setButtons = buttons => this.emit('buttons', buttons)
            child.on('write', write)
            child.on('buttons', setButtons)
            child.on('exit', code => {
              child.removeListener('write', write)
              child.removeListener('buttons', setButtons)
              this.destroy()
            })
            child.run(...args)
          } else {
            this.emit('write', Process)
            this.destroy()
          }
        } else {
          this.emit('write', `sudo: ${name}: command not found\r\n`)
          this.destroy()
        }
      }
    }
    destroy () {
      if (this.didDestroy) return
      this.didDestroy = true
      if (this.child) this.child.destroy()
      super.destroy()
    }
  },
  make: class Make extends Process {
    constructor (shell, options = {}) {
      super()
      this.su = options.su
    }
    run (...args) {
      if (args.length === 0) this.emit('write', '\x1b[31mmake: *** No targets specified.  Stop.\x1b[0m\r\n')
      else if (args.length === 3 && args.join(' ').toLowerCase() === 'me a sandwich') {
        if (this.su) {
          const b = '\x1b[33m'
          const r = '\x1b[0m'
          const l = '\x1b[32m'
          const c = '\x1b[38;5;229m'
          const h = '\x1b[38;5;225m'
          this.emit('write',
            `                    ${b}_.---._\r\n` +
            `                _.-~       ~-._\r\n` +
            `            _.-~               ~-._\r\n` +
            `        _.-~                       ~---._\r\n` +
            `    _.-~                                 ~\\\r\n` +
            ` .-~                                    _.;\r\n` +
            ` :-._                               _.-~ ./\r\n` +
            ` \`-._~-._                   _..__.-~ _.-~\r\n` +
            `  ${c}/  ${b}~-._~-._              / .__..--${c}~-${l}---._\r\n` +
            `${c} \\_____(_${b};-._\\.        _.-~_/${c}       ~)${l}.. . \\\r\n` +
            `${l}    /(_____  ${b}\\\`--...--~_.-~${c}______..-+${l}_______)\r\n` +
            `${l}  .(_________/${b}\`--...--~/${l}    _/ ${h}          ${b}/\\\r\n` +
            `${b} /-._${h}     \\_     ${l}(___./_..-~${h}__.....${b}__..-~./\r\n` +
            `${b} \`-._~-._${h}   ~\\--------~  .-~${b}_..__.-~ _.-~\r\n` +
            `${b}     ~-._~-._ ${h}~---------\`  ${b}/ .__..--~\r\n` +
            `${b}         ~-._\\.        _.-~_/\r\n` +
            `${b}             \\\`--...--~_.-~\r\n` +
            `${b}              \`--...--~${r}\r\n`)
        } else {
          this.emit('write', '\x1b[31mmake: me a sandwich : Permission denied\x1b[0m\r\n')
        }
      } else {
        this.emit('write', `\x1b[31mmake: *** No rule to make target '${args.join(' ').toLowerCase()}'.  Stop.\x1b[0m\r\n`)
      }
      this.destroy()
    }
  },
  pwd: '/this/is/a/demo\r\n',
  cd: '\x1b[38;5;239mNo directories to change to\r\n',
  whoami: `${window.navigator.userAgent}\r\n`,
  hostname: `${window.location.hostname}`,
  uname: 'ESPTerm Demo\r\n',
  mkdir: '\x1b[38;5;239mDid not create a directory because this is a demo.\r\n',
  rm: '\x1b[38;5;239mDid not delete anything because this is a demo.\r\n',
  cp: '\x1b[38;5;239mNothing to copy because this is a demo.\r\n',
  mv: '\x1b[38;5;239mNothing to move because this is a demo.\r\n',
  ln: '\x1b[38;5;239mNothing to link because this is a demo.\r\n',
  touch: '\x1b[38;5;239mNothing to touch\r\n',
  exit: '\x1b[38;5;239mNowhere to go\r\n',
  github: class GoToGithub extends Process {
    run () {
      window.open('https://github.com/espterm/espterm-firmware')
      this.destroy()
    }
  }
}
let autocompleteIndex = {
  'local-echo': 'local-echo [--suppress-note]',
  theme: 'theme [n]',
  cursor: 'cursor [block|line|bar] [--steady]',
  sudo: 'sudo [command]'
}

class DemoShell {
  constructor (terminal, printInfo) {
    this.terminal = terminal
    this.terminal.reset()
    this.parser = new ANSIParser((...args) => this.handleParsed(...args))
    this.history = []
    this.historyIndex = 0
    this.cursorPos = 0
    this.lastInputLength = 0
    this.child = null
    this.index = demoshIndex

    if (printInfo) this.run('info')
    else this.prompt()
  }
  write (text) {
    if (this.child) {
      if (text.codePointAt(0) === 3) this.child.destroy()
      else this.child.write(text)
    } else this.parser.write(text)
  }
  prompt (success = true) {
    if (this.terminal.cursor.x !== 0) this.terminal.write('\x1b[m\x1b[38;5;238m⏎\r\n')
    this.terminal.write('\x1b[34;1mdemosh \x1b[m')
    if (!success) this.terminal.write('\x1b[31m')
    this.terminal.write('$ \x1b[m')
    this.history.unshift('')
    this.cursorPos = 0

    this.setButtons()
  }
  copyFromHistoryIndex () {
    if (!this.historyIndex) return
    let current = this.history[this.historyIndex]
    this.history[0] = current
    this.historyIndex = 0
  }
  getCompleted (visual = false) {
    if (this.history[0]) {
      let input = this.history[0]
      let prefix = ''
      if (input.startsWith('sudo ')) {
        let newInput = input.replace(/^(sudo\s+)+/, '')
        prefix = input.substr(0, input.length - newInput.length)
        input = newInput
      }
      if (!input) return null
      for (let name in this.index) {
        if (name.startsWith(input) && name !== input) {
          if (visual && name in autocompleteIndex) return prefix + autocompleteIndex[name]
          return prefix + name
        }
      }
      return null
    }
    return null
  }
  handleParsed (action, ...args) {
    this.terminal.write(`\x1b[${this.lastInputLength - this.cursorPos}P`)
    this.terminal.write('\b\x1b[P'.repeat(this.cursorPos))

    if (action === 'write') {
      this.copyFromHistoryIndex()
      this.history[0] = this.history[0].substr(0, this.cursorPos) + args[0] + this.history[0].substr(this.cursorPos)
      this.cursorPos++
    } else if (action === 'back') {
      this.copyFromHistoryIndex()
      this.history[0] = this.history[0].substr(0, this.cursorPos - 1) + this.history[0].substr(this.cursorPos)
      this.cursorPos--
      if (this.cursorPos < 0) this.cursorPos = 0
    } else if (action === 'tab') {
      let completed = this.getCompleted()
      if (completed) {
        this.history[0] = completed
        this.cursorPos = this.history[0].length
      }
    } else if (action === 'move-cursor-x') {
      this.cursorPos = Math.max(0, Math.min(this.history[this.historyIndex].length, this.cursorPos + args[0]))
    } else if (action === 'delete-line') {
      this.copyFromHistoryIndex()
      this.history[0] = ''
      this.cursorPos = 0
    } else if (action === 'delete-word') {
      this.copyFromHistoryIndex()
      let words = this.history[0].substr(0, this.cursorPos).split(' ')
      words.pop()
      this.history[0] = words.join(' ') + this.history[0].substr(this.cursorPos)
      this.cursorPos = words.join(' ').length
    } else if (action === 'move-cursor-y') {
      this.historyIndex -= args[0]
      if (this.historyIndex < 0) this.historyIndex = 0
      if (this.historyIndex >= this.history.length) this.historyIndex = this.history.length - 1
      this.cursorPos = this.history[this.historyIndex].length
    }

    this.terminal.write(this.history[this.historyIndex])
    this.terminal.write('\b'.repeat(this.history[this.historyIndex].length))
    this.terminal.moveForward(this.cursorPos)

    this.lastInputLength = this.cursorPos

    let completed = this.getCompleted(true)
    if (this.historyIndex === 0 && completed && action !== 'return') {
      // show closest match faintly
      let rest = completed.substr(this.history[0].length)
      this.terminal.write(`\x1b[2m${rest}\x1b[m${'\b'.repeat(rest.length)}`)
      this.lastInputLength += rest.length
    }

    if (action === 'return') {
      this.terminal.write('\n')
      this.parse(this.history[this.historyIndex])
    }
  }
  parse (input) {
    if (input === 'help') input = 'info'
    // TODO: basic chaining (i.e. semicolon)
    if (input) this.run(input)
    else this.prompt()
  }
  run (command) {
    let parts = ['']

    let inQuote = false
    for (let character of command.trim()) {
      if (inQuote && character !== inQuote) {
        parts[parts.length - 1] += character
      } else if (inQuote) {
        inQuote = false
      } else if (character === '"' || character === "'") {
        inQuote = character
      } else if (character.match(/\s/)) {
        if (parts[parts.length - 1]) parts.push('')
      } else parts[parts.length - 1] += character
    }

    let name = parts.shift()

    if (name in this.index) {
      this.spawn(name, parts)
    } else {
      this.terminal.write(`demosh: Unknown command: ${name}\r\n`)
      this.prompt(false)
    }
  }
  spawn (name, args = []) {
    let Process = this.index[name]
    if (Process instanceof Function) {
      this.setButtons([])
      this.child = new Process(this)
      let write = data => this.terminal.write(data)
      let setButtons = buttons => this.setButtons(buttons)
      this.child.on('write', write)
      this.child.on('buttons', setButtons)
      this.child.on('exit', code => {
        if (this.child) {
          this.child.removeListener('write', write)
          this.child.removeListener('buttons', setButtons)
        }
        this.child = null
        this.prompt(!code)
      })
      this.child.run(...args)
    } else {
      this.terminal.write(Process)
      this.prompt()
    }
  }

  setButtons (buttons) {
    if (!buttons) {
      const shell = this
      let writeChars = chars => {
        let loop = () => {
          shell.write(chars[0])
          chars = chars.substr(1)
          if (chars) setTimeout(loop, 100)
        }
        setTimeout(loop, 200)
      }

      buttons = [
        {
          label: 'Open GitHub',
          action (shell) {
            if (shell.child) shell.child.destroy()
            writeChars('github\r')
          }
        },
        {
          label: 'Help',
          action (shell) {
            if (shell.child) shell.child.destroy()
            writeChars('info\r')
          }
        }
      ]
    }
    if (!buttons.length) buttons.push({ label: '', action () {} })
    this.buttons = buttons
    this.terminal.buttonLabels = buttons.map(x => x.label)
  }

  onButtonPress (index) {
    let button = this.buttons[index]
    if (!button) return
    button.action(this, this.terminal)
  }
}

window.demoInterface = module.exports = {
  input (data) {
    let type = data[0]
    let content = data.substr(1)

    if (type === 's') {
      this.shell.write(content)
    } else if (type === 'b') {
      let button = content.charCodeAt(0)
      this.shell.onButtonPress(button - 1)
    } else if (type === 'm' || type === 'p' || type === 'r') {
      let row = parse2B(content, 0)
      let column = parse2B(content, 2)
      let button = parse2B(content, 4)
      let modifiers = parse2B(content, 6)

      if (demoData.mouseReceiver) {
        if (type === 'm') demoData.mouseReceiver.mouseMove(column, row, button, modifiers)
        else if (type === 'p') demoData.mouseReceiver.mouseDown(column, row, button, modifiers)
        else if (type === 'r') demoData.mouseReceiver.mouseUp(column, row, button, modifiers)
      }
    }
  },
  didInit: false,
  init (screen) {
    if (this.didInit) return
    this.didInit = true
    this.terminal = new ScrollingTerminal(screen)
    this.shell = new DemoShell(this.terminal, true)
  }
}
