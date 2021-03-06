const EventEmitter = require('events')
const {
  themes,
  getColor
} = require('./themes')

const {
  ATTR_FG,
  ATTR_BG,
  ATTR_BOLD,
  ATTR_UNDERLINE,
  ATTR_INVERSE,
  ATTR_BLINK,
  ATTR_ITALIC,
  ATTR_STRIKE,
  ATTR_OVERLINE,
  ATTR_FAINT,
  ATTR_FRAKTUR
} = require('./screen_attr_bits')

// Some non-bold Fraktur symbols are outside the contiguous block
const frakturExceptions = {
  'C': '\u212d',
  'H': '\u210c',
  'I': '\u2111',
  'R': '\u211c',
  'Z': '\u2128'
}

/**
 * A terminal screen renderer, using canvas 2D
 */
module.exports = class CanvasRenderer extends EventEmitter {
  constructor (canvas) {
    super()

    this.canvas = canvas
    this.ctx = this.canvas.getContext('2d')

    this._palette = null // colors 0-15
    this.defaultBG = 0
    this.defaultFG = 7

    this.debug = false
    this._debug = null

    this.graphics = 0

    this.statusFont = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Roboto, Arial, sans-serif"

    // screen data, considered immutable
    this.width = 0
    this.height = 0
    this.padding = 0
    this.charSize = { width: 0, height: 0 }
    this.cellSize = { width: 0, height: 0 }
    this.fonts = ['', '', '', ''] // normal, bold, italic, bold-italic
    this.screen = []
    this.screenFG = []
    this.screenBG = []
    this.screenAttrs = []
    this.screenSelection = []
    this.screenLines = []
    this.cursor = {}
    this.reverseVideo = false
    this.hasBlinkingCells = false
    this.statusScreen = null

    this.resetDrawn()

    this.blinkStyleOn = false
    this.blinkInterval = null
    this.cursorBlinkOn = false
    this.cursorBlinkInterval = null

    // start blink timers
    this.resetBlink()
    this.resetCursorBlink()
  }

  render (reason, data) {
    if ('hasBlinkingCells' in data && data.hasBlinkingCells !== this.hasBlinkingCells) {
      if (data.hasBlinkingCells) this.resetBlink()
      else clearInterval(this.blinkInterval)
    }

    Object.assign(this, data)
    this.scheduleDraw(reason)
  }

  resetDrawn () {
    // used to determine if a cell should be redrawn; storing the current state
    // as it is on screen
    if (this.debug) console.log('Resetting drawn screen')

    this.drawnScreen = []
    this.drawnScreenFG = []
    this.drawnScreenBG = []
    this.drawnScreenAttrs = []
    this.drawnScreenLines = []
    this.drawnCursor = [-1, -1, '', false]
  }

  /**
   * The color palette. Should define 16 colors in an array.
   * @type {string[]}
   */
  get palette () {
    return this._palette || themes[0]
  }

  /** @type {string[]} */
  set palette (palette) {
    if (this._palette !== palette) {
      this._palette = palette
      this.resetDrawn()
      this.emit('palette-update', palette)
      this.scheduleDraw('palette')
    }
  }

  getCharWidthFor (font) {
    this.ctx.font = font
    return Math.floor(this.ctx.measureText(' ').width)
  }

  loadTheme (i) {
    if (i in themes) this.palette = themes[i]
  }

  setDefaultColors (fg, bg) {
    if (fg !== this.defaultFG || bg !== this.defaultBG) {
      this.resetDrawn()
      this.defaultFG = fg
      this.defaultBG = bg
      this.scheduleDraw('default-colors')

      // full bg with default color (goes behind the image)
      this.canvas.style.backgroundColor = this.getColor(bg)
    }
  }

  /**
   * Schedule a draw in the next millisecond
   * @param {string} why - the reason why the draw occured (for debugging)
   * @param {number} [aggregateTime] - time to wait for more scheduleDraw calls
   *   to occur. 1 ms by default.
   */
  scheduleDraw (why, aggregateTime = 1) {
    clearTimeout(this._scheduledDraw)
    this._scheduledDraw = setTimeout(() => this.draw(why), aggregateTime)
  }

  /**
   * Returns the specified color. If `i` is in the palette, it will return the
   * palette color. If `i` is between 16 and 255, it will return the 256color
   * value. If `i` is larger than 255, it will return an RGB color value. If `i`
   * is -1 (foreground) or -2 (background), it will return the selection colors.
   * @param {number} i - the color
   * @returns {string} the CSS color
   */
  getColor (i) {
    return getColor(i, this.palette)
  }

  /**
   * Resets the cursor blink to on and restarts the timer
   */
  resetCursorBlink () {
    this.cursorBlinkOn = true
    clearInterval(this.cursorBlinkInterval)
    this.cursorBlinkInterval = setInterval(() => {
      this.cursorBlinkOn = this.cursor.blinking ? !this.cursorBlinkOn : true
      if (this.cursor.blinking) this.scheduleDraw('cursor-blink')
    }, 500)
  }

  /**
   * Resets the blink style to on and restarts the timer
   */
  resetBlink () {
    this.blinkStyleOn = true
    clearInterval(this.blinkInterval)
    let intervals = 0
    this.blinkInterval = setInterval(() => {
      if (this.blinkingCellCount <= 0) return

      intervals++
      if (intervals >= 4 && this.blinkStyleOn) {
        this.blinkStyleOn = false
        intervals = 0
        this.scheduleDraw('blink-style')
      } else if (intervals >= 1 && !this.blinkStyleOn) {
        this.blinkStyleOn = true
        intervals = 0
        this.scheduleDraw('blink-style')
      }
    }, 200)
  }

  /**
   * Draws a cell's background with the given parameters.
   * @param {Object} options
   * @param {number} options.x - x in cells
   * @param {number} options.y - y in cells
   * @param {number} options.cellWidth - cell width in pixels
   * @param {number} options.cellHeight - cell height in pixels
   * @param {number} options.bg - the background color
   * @param {number} options.isDefaultBG - if true, will draw image background if available
   */
  drawBackground ({ x, y, cellWidth, cellHeight, bg, isDefaultBG }) {
    const { ctx, width, height, padding } = this

    // is a double-width/double-height line
    if (this.screenLines[y] & 0b001) cellWidth *= 2

    ctx.fillStyle = this.getColor(bg)
    let screenX = x * cellWidth + padding
    let screenY = y * cellHeight + padding
    let isBorderCell = x === 0 || y === 0 || x === width - 1 || y === height - 1

    let fillX, fillY, fillWidth, fillHeight
    if (isBorderCell) {
      let left = screenX
      let top = screenY
      let right = screenX + cellWidth
      let bottom = screenY + cellHeight
      if (x === 0) left -= padding
      else if (x === width - 1) right += padding
      if (y === 0) top -= padding
      else if (y === height - 1) bottom += padding

      fillX = left
      fillY = top
      fillWidth = right - left
      fillHeight = bottom - top
    } else {
      fillX = screenX
      fillY = screenY
      fillWidth = cellWidth
      fillHeight = cellHeight
    }

    ctx.clearRect(fillX, fillY, fillWidth, fillHeight)

    if (!isDefaultBG || bg < 0 || !this.backgroundImage) {
      ctx.fillRect(fillX, fillY, fillWidth, fillHeight)
    }
  }

  /**
   * Draws a cell's character with the given parameters. Won't do anything if
   * text is an empty string.
   * @param {Object} options
   * @param {number} options.x - x in cells
   * @param {number} options.y - y in cells
   * @param {Object} options.charSize - the character size, an object with
   *   `width` and `height` in pixels
   * @param {number} options.cellWidth - cell width in pixels
   * @param {number} options.cellHeight - cell height in pixels
   * @param {string} options.text - the cell content
   * @param {number} options.fg - the foreground color
   * @param {number} options.attrs - the cell's attributes
   */
  drawCharacter ({ x, y, charSize, cellWidth, cellHeight, text, fg, attrs }) {
    if (!text) return

    const { ctx, padding } = this

    let underline = false
    let strike = false
    let overline = false
    if (attrs & ATTR_FAINT) ctx.globalAlpha = 0.5
    if (attrs & ATTR_UNDERLINE) underline = true
    if (attrs & ATTR_FRAKTUR) text = CanvasRenderer.alphaToFraktur(text)
    if (attrs & ATTR_STRIKE) strike = true
    if (attrs & ATTR_OVERLINE) overline = true

    ctx.fillStyle = this.getColor(fg)

    let screenX = x * cellWidth + padding
    let screenY = y * cellHeight + padding

    const dblWidth = this.screenLines[y] & 0b001
    const dblHeightTop = this.screenLines[y] & 0b010
    const dblHeightBot = this.screenLines[y] & 0b100

    if (this.screenLines[y]) {
      // is a double-width/double-height line
      if (dblWidth) cellWidth *= 2

      ctx.save()
      ctx.translate(padding, screenY + 0.5 * cellHeight)
      if (dblWidth) ctx.scale(2, 1)
      if (dblHeightTop) {
        // top half
        ctx.scale(1, 2)
        ctx.translate(0, cellHeight / 4)
      } else if (dblHeightBot) {
        // bottom half
        ctx.scale(1, 2)
        ctx.translate(0, -cellHeight / 4)
      }
      ctx.translate(-padding, -screenY - 0.5 * cellHeight)
      if (dblWidth) ctx.translate(-cellWidth / 4, 0)

      if (dblHeightBot || dblHeightTop) {
        // characters overflow -- needs clipping
        // TODO: clipping is really expensive
        ctx.beginPath()
        if (dblHeightTop) ctx.rect(screenX, screenY, cellWidth, cellHeight / 2)
        else ctx.rect(screenX, screenY + cellHeight / 2, cellWidth, cellHeight / 2)
        ctx.clip()
      }
    }

    let codePoint = text.codePointAt(0)
    if (codePoint >= 0x2580 && codePoint <= 0x259F) {
      // block elements
      ctx.beginPath()
      const left = screenX
      const top = screenY
      const cw = cellWidth
      const ch = cellHeight
      const c2w = cellWidth / 2
      const c2h = cellHeight / 2

      // http://www.fileformat.info/info/unicode/block/block_elements/utf8test.htm
      //         0x00  0x01  0x02  0x03  0x04  0x05  0x06  0x07  0x08  0x09  0x0A  0x0B  0x0C  0x0D  0x0E  0x0F
      // 0x2580     ▀     ▁     ▂     ▃     ▄     ▅     ▆     ▇     █     ▉     ▊     ▋     ▌     ▍     ▎     ▏
      // 0x2590     ▐     ░     ▒     ▓     ▔     ▕     ▖     ▗     ▘     ▙     ▚     ▛     ▜     ▝     ▞     ▟

      if (codePoint === 0x2580) {
        // upper half block >▀<
        ctx.rect(left, top, cw, c2h)
      } else if (codePoint <= 0x2588) {
        // lower n eighth block (increasing) >▁< to >█<
        let offset = (1 - (codePoint - 0x2580) / 8) * ch
        ctx.rect(left, top + offset, cw, ch - offset)
      } else if (codePoint <= 0x258F) {
        // left n eighth block (decreasing) >▉< to >▏<
        let offset = (codePoint - 0x2588) / 8 * cw
        ctx.rect(left, top, cw - offset, ch)
      } else if (codePoint === 0x2590) {
        // right half block >▐<
        ctx.rect(left + c2w, top, c2w, ch)
      } else if (codePoint <= 0x2593) {
        // shading >░< >▒< >▓<

        // dot spacing by dividing cell size by a constant. This could be
        // reworked to always return a whole number, but that would require
        // prime factorization, and doing that without a loop would let you
        // take over the world, which is not within the scope of this project.
        let dotSpacingX, dotSpacingY, dotSize
        if (codePoint === 0x2591) {
          dotSpacingX = cw / 4
          dotSpacingY = ch / 10
          dotSize = 1
        } else if (codePoint === 0x2592) {
          dotSpacingX = cw / 6
          dotSpacingY = cw / 10
          dotSize = 1
        } else if (codePoint === 0x2593) {
          dotSpacingX = cw / 4
          dotSpacingY = cw / 7
          dotSize = 2
        }

        let alignRight = false
        for (let dy = 0; dy < ch; dy += dotSpacingY) {
          for (let dx = 0; dx < cw; dx += dotSpacingX) {
            // prevent overflow
            let dotSizeY = Math.min(dotSize, ch - dy)
            ctx.rect(left + (alignRight ? cw - dx - dotSize : dx), top + dy, dotSize, dotSizeY)
          }
          alignRight = !alignRight
        }
      } else if (codePoint === 0x2594) {
        // upper one eighth block >▔<
        ctx.rect(left, top, cw, ch / 8)
      } else if (codePoint === 0x2595) {
        // right one eighth block >▕<
        ctx.rect(left + (7 / 8) * cw, top, cw / 8, ch)
      } else if (codePoint === 0x2596) {
        // left bottom quadrant >▖<
        ctx.rect(left, top + c2h, c2w, c2h)
      } else if (codePoint === 0x2597) {
        // right bottom quadrant >▗<
        ctx.rect(left + c2w, top + c2h, c2w, c2h)
      } else if (codePoint === 0x2598) {
        // left top quadrant >▘<
        ctx.rect(left, top, c2w, c2h)
      } else if (codePoint === 0x2599) {
        // left chair >▙<
        ctx.rect(left, top, c2w, ch)
        ctx.rect(left + c2w, top + c2h, c2w, c2h)
      } else if (codePoint === 0x259A) {
        // quadrants lt rb >▚<
        ctx.rect(left, top, c2w, c2h)
        ctx.rect(left + c2w, top + c2h, c2w, c2h)
      } else if (codePoint === 0x259B) {
        // left chair upside down >▛<
        ctx.rect(left, top, c2w, ch)
        ctx.rect(left + c2w, top, c2w, c2h)
      } else if (codePoint === 0x259C) {
        // right chair upside down >▜<
        ctx.rect(left, top, cw, c2h)
        ctx.rect(left + c2w, top + c2h, c2w, c2h)
      } else if (codePoint === 0x259D) {
        // right top quadrant >▝<
        ctx.rect(left + c2w, top, c2w, c2h)
      } else if (codePoint === 0x259E) {
        // quadrants lb rt >▞<
        ctx.rect(left, top + c2h, c2w, c2h)
        ctx.rect(left + c2w, top, c2w, c2h)
      } else if (codePoint === 0x259F) {
        // right chair upside down >▟<
        ctx.rect(left, top + c2h, c2w, c2h)
        ctx.rect(left + c2w, top, c2w, ch)
      }

      ctx.fill()
    } else if (codePoint >= 0xE0B0 && codePoint <= 0xE0B3) {
      // powerline symbols, except branch, line, and lock. Basically, just the triangles
      ctx.beginPath()

      if (codePoint === 0xE0B0 || codePoint === 0xE0B1) {
        // right-pointing triangle
        ctx.moveTo(screenX, screenY)
        ctx.lineTo(screenX + cellWidth, screenY + cellHeight / 2)
        ctx.lineTo(screenX, screenY + cellHeight)
      } else if (codePoint === 0xE0B2 || codePoint === 0xE0B3) {
        // left-pointing triangle
        ctx.moveTo(screenX + cellWidth, screenY)
        ctx.lineTo(screenX, screenY + cellHeight / 2)
        ctx.lineTo(screenX + cellWidth, screenY + cellHeight)
      }

      if (codePoint % 2 === 0) {
        // triangle
        ctx.fill()
      } else {
        // chevron
        ctx.strokeStyle = ctx.fillStyle
        ctx.stroke()
      }
    } else {
      // Draw other characters using the text renderer
      ctx.fillText(text, screenX + 0.5 * cellWidth, screenY + 0.5 * cellHeight)
    }

    // -- line drawing - a reference for a possible future rect/line implementation ---
    // http://www.fileformat.info/info/unicode/block/box_drawing/utf8test.htm
    //         0x00  0x01  0x02  0x03  0x04  0x05  0x06  0x07  0x08  0x09  0x0A  0x0B  0x0C  0x0D  0x0E  0x0F
    // 0x2500     ─     ━     │     ┃     ┄     ┅     ┆     ┇     ┈     ┉     ┊     ┋     ┌     ┍     ┎     ┏
    // 0x2510     ┐     ┑     ┒     ┓     └     ┕     ┖     ┗     ┘     ┙     ┚     ┛     ├     ┝     ┞     ┟
    // 0x2520     ┠     ┡     ┢     ┣     ┤     ┥     ┦     ┧     ┨     ┩     ┪     ┫     ┬     ┭     ┮     ┯
    // 0x2530     ┰     ┱     ┲     ┳     ┴     ┵     ┶     ┷     ┸     ┹     ┺     ┻     ┼     ┽     ┾     ┿
    // 0x2540     ╀     ╁     ╂     ╃     ╄     ╅     ╆     ╇     ╈     ╉     ╊     ╋     ╌     ╍     ╎     ╏
    // 0x2550     ═     ║     ╒     ╓     ╔     ╕     ╖     ╗     ╘     ╙     ╚     ╛     ╜     ╝     ╞     ╟
    // 0x2560     ╠     ╡     ╢     ╣     ╤     ╥     ╦     ╧     ╨     ╩     ╪     ╫     ╬     ╭     ╮     ╯
    // 0x2570     ╰     ╱     ╲     ╳     ╴     ╵     ╶     ╷     ╸     ╹     ╺     ╻     ╼     ╽     ╾     ╿

    if (underline || strike || overline) {
      ctx.strokeStyle = this.getColor(fg)
      ctx.lineWidth = 1
      ctx.lineCap = 'round'
      ctx.beginPath()

      if (underline) {
        let lineY = Math.round(screenY + charSize.height) + 0.5
        ctx.moveTo(screenX, lineY)
        ctx.lineTo(screenX + cellWidth, lineY)
      }

      if (strike) {
        let lineY = Math.round(screenY + 0.5 * cellHeight) + 0.5
        ctx.moveTo(screenX, lineY)
        ctx.lineTo(screenX + cellWidth, lineY)
      }

      if (overline) {
        let lineY = Math.round(screenY) + 0.5
        ctx.moveTo(screenX, lineY)
        ctx.lineTo(screenX + cellWidth, lineY)
      }

      ctx.stroke()
    }

    if (this.screenLines[y]) ctx.restore()

    ctx.globalAlpha = 1
  }

  /**
   * Returns all adjacent cell indices given a radius.
   * @param {number} cell - the center cell index
   * @param {number} [radius] - the radius. 1 by default
   * @returns {number[]} an array of cell indices
   */
  getAdjacentCells (cell, radius = 1) {
    const { width, height } = this
    const screenLength = width * height

    let cells = []

    for (let x = -radius; x <= radius; x++) {
      for (let y = -radius; y <= radius; y++) {
        if (x === 0 && y === 0) continue
        cells.push(cell + x + y * width)
      }
    }

    return cells.filter(cell => cell >= 0 && cell < screenLength)
  }

  /**
   * Updates the screen.
   * @param {string} why - the draw reason (for debugging)
   */
  draw (why) {
    const ctx = this.ctx
    const {
      width,
      height,
      devicePixelRatio,
      statusScreen
    } = this

    if (statusScreen) {
      // draw status screen instead
      this.drawStatus(statusScreen)
      this.startDrawLoop()
      return
    } else this.stopDrawLoop()

    const charSize = this.charSize
    const { width: cellWidth, height: cellHeight } = this.cellSize
    const screenLength = width * height

    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)

    if (this.debug && this._debug) this._debug.drawStart(why)

    ctx.font = this.fonts[0]
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // bits in the attr value that affect the font
    const FONT_MASK = ATTR_BOLD | ATTR_ITALIC

    // Map of (attrs & FONT_MASK) -> Array of cell indices
    let fontGroups = new Map()

    // Map of (cell index) -> boolean, whether or not a cell has updated
    let updateMap = new Map()

    for (let cell = 0; cell < screenLength; cell++) {
      let x = cell % width
      let y = Math.floor(cell / width)
      let isCursor = this.cursorBlinkOn &&
        this.cursor.x === x &&
        this.cursor.y === y &&
        this.cursor.visible

      let wasCursor = x === this.drawnCursor[0] && y === this.drawnCursor[1]

      let text = this.screen[cell]
      let fg = this.screenFG[cell] | 0
      let bg = this.screenBG[cell] | 0
      let attrs = this.screenAttrs[cell] | 0
      let inSelection = this.screenSelection[cell]

      let isDefaultBG = false

      if (!(attrs & ATTR_FG)) fg = this.defaultFG
      if (!(attrs & ATTR_BG)) {
        bg = this.defaultBG
        isDefaultBG = true
      }

      if (attrs & ATTR_INVERSE) [fg, bg] = [bg, fg] // swap - reversed character colors
      if (this.reverseVideo) [fg, bg] = [bg, fg] // swap - reversed all screen

      if (attrs & ATTR_BLINK && !this.blinkStyleOn) {
        // blinking is enabled and blink style is off
        // set text to nothing so drawCharacter only draws decoration
        text = ' '
      }

      if (inSelection) {
        fg = -1
        bg = -2
      }

      let didUpdate = text !== this.drawnScreen[cell] || // text updated
        fg !== this.drawnScreenFG[cell] || // foreground updated, and this cell has text
        bg !== this.drawnScreenBG[cell] || // background updated
        attrs !== this.drawnScreenAttrs[cell] || // attributes updated
        this.screenLines[y] !== this.drawnScreenLines[y] || // line updated
        // TODO: fix artifacts or keep this hack:
        isCursor || wasCursor || // cursor blink/position updated
        (isCursor && this.cursor.style !== this.drawnCursor[2]) || // cursor style updated
        (isCursor && this.cursor.hanging !== this.drawnCursor[3]) // cursor hanging updated

      let font = attrs & FONT_MASK
      if (!fontGroups.has(font)) fontGroups.set(font, [])

      fontGroups.get(font).push({ cell, x, y, text, fg, bg, attrs, isCursor, inSelection, isDefaultBG })
      updateMap.set(cell, didUpdate)
    }

    // set drawn screen lines
    this.drawnScreenLines = this.screenLines.slice()

    let debugFilledUpdates = []

    if (this.graphics >= 1) {
      // fancy graphics gets really slow when there's a lot of masks
      // so here's an algorithm that fills in holes in the update map

      for (let cell of updateMap.keys()) {
        if (updateMap.get(cell)) continue
        let previous = updateMap.get(cell - 1) || false
        let next = updateMap.get(cell + 1) || false

        if (previous && next) {
          // set cell to true of horizontally adjacent updated
          updateMap.set(cell, true)
          if (this.debug && this._debug) debugFilledUpdates.push(cell)
        }
      }
    }

    // Map of (cell index) -> boolean, whether or not a cell should be redrawn
    const redrawMap = new Map()
    const maskedCells = new Map()

    let isTextWide = text =>
      text !== ' ' && ctx.measureText(text).width >= (cellWidth + 0.05)

    // decide for each cell if it should be redrawn
    for (let cell of updateMap.keys()) {
      let shouldUpdate = updateMap.get(cell) || redrawMap.get(cell) || false

      // TODO: fonts (necessary?)
      let text = this.screen[cell]
      let isWideCell = isTextWide(text)
      let checkRadius = isWideCell ? 2 : 1

      if (!shouldUpdate) {
        // check adjacent cells
        let adjacentDidUpdate = false

        for (let adjacentCell of this.getAdjacentCells(cell, checkRadius)) {
          // update this cell if:
          // - the adjacent cell updated (For now, this'll always be true because characters can be slightly larger than they say they are)
          // - the adjacent cell updated and this cell or the adjacent cell is wide
          // - this or the adjacent cell is not double-sized
          if (updateMap.get(adjacentCell) &&
              (this.graphics < 2 || isWideCell || isTextWide(this.screen[adjacentCell])) &&
              (!this.screenLines[Math.floor(cell / this.width)] && !this.screenLines[Math.floor(adjacentCell / this.width)])) {
            adjacentDidUpdate = true

            if (this.getAdjacentCells(cell, 1).includes(adjacentCell)) {
              // this is within a radius of 1, therefore this cell should be included in the mask as well
              maskedCells.set(cell, true)
            }
            break
          }
        }

        if (adjacentDidUpdate) shouldUpdate = true
      }

      if (updateMap.get(cell)) {
        // this was updated, it should definitely be included in the mask
        maskedCells.set(cell, true)
      }

      redrawMap.set(cell, shouldUpdate)
    }

    // mask to masked regions only
    if (this.graphics >= 1) {
      // TODO: include padding in border cells
      const padding = this.padding

      let regions = []

      for (let y = 0; y < height; y++) {
        let regionStart = null
        for (let x = 0; x < width; x++) {
          let cell = y * width + x
          let masked = maskedCells.get(cell)
          if (masked && regionStart === null) regionStart = x
          if (!masked && regionStart !== null) {
            regions.push([regionStart, y, x, y + 1])
            regionStart = null
          }
        }
        if (regionStart !== null) {
          regions.push([regionStart, y, width, y + 1])
        }
      }

      // join regions if possible (O(n^2-1), sorry)
      let i = 0
      while (i < regions.length) {
        let region = regions[i]
        let j = 0
        while (j < regions.length) {
          let other = regions[j]
          if (other === region) {
            j++
            continue
          }
          if (other[0] === region[0] && other[2] === region[2] && other[3] === region[1]) {
            region[1] = other[1]
            regions.splice(j, 1)
            if (i > j) i--
            j--
          }
          j++
        }
        i++
      }

      ctx.save()
      ctx.beginPath()
      for (let region of regions) {
        let [regionStart, y, endX, endY] = region
        let rectX = padding + regionStart * cellWidth
        let rectY = padding + y * cellHeight
        let rectWidth = (endX - regionStart) * cellWidth
        let rectHeight = (endY - y) * cellHeight

        // compensate for padding
        if (regionStart === 0) {
          rectX -= padding
          rectWidth += padding
        }
        if (y === 0) {
          rectY -= padding
          rectHeight += padding
        }
        if (endX === width - 1) rectWidth += padding
        if (y === height - 1) rectHeight += padding

        ctx.rect(rectX, rectY, rectWidth, rectHeight)
      }
      ctx.clip()
    }

    // pass 1: backgrounds
    for (let font of fontGroups.keys()) {
      for (let data of fontGroups.get(font)) {
        let { cell, x, y, text, bg, isDefaultBG } = data

        if (redrawMap.get(cell)) {
          this.drawBackground({ x, y, cellWidth, cellHeight, bg, isDefaultBG })

          if (this.debug) {
            // set cell flags
            let flags = (+redrawMap.get(cell))
            flags |= (+updateMap.get(cell)) << 1
            flags |= (+maskedCells.get(cell)) << 2
            flags |= (+isTextWide(text)) << 3
            flags |= (+debugFilledUpdates.includes(cell)) << 4
            this._debug.setCell(cell, flags)
          }
        }
      }
    }

    // reset drawn cursor
    this.drawnCursor = [-1, -1, '', false]

    // pass 2: characters
    for (let font of fontGroups.keys()) {
      // set font once because in Firefox, this is a really slow action for some
      // reason
      let fontIndex = 0
      if (font & ATTR_BOLD) fontIndex |= 1
      if (font & ATTR_ITALIC) fontIndex |= 2
      ctx.font = this.fonts[fontIndex]

      for (let data of fontGroups.get(font)) {
        let { cell, x, y, text, fg, bg, attrs, isCursor, inSelection } = data

        if (redrawMap.get(cell)) {
          this.drawCharacter({
            x, y, charSize, cellWidth, cellHeight, text, fg, attrs
          })

          this.drawnScreen[cell] = text
          this.drawnScreenFG[cell] = fg
          this.drawnScreenBG[cell] = bg
          this.drawnScreenAttrs[cell] = attrs

          if (isCursor) this.drawnCursor = [x, y, this.cursor.style, this.cursor.hanging]

          // draw cursor
          if (isCursor && !inSelection) {
            ctx.save()
            ctx.beginPath()

            let cursorX = x
            let cursorY = y
            let cursorWidth = cellWidth // JS doesn't allow same-name assignment

            if (this.cursor.hanging) {
              // draw hanging cursor in the margin
              cursorX += 1
            }

            // double-width lines
            if (this.screenLines[cursorY] & 0b001) cursorWidth *= 2

            let screenX = cursorX * cursorWidth + this.padding
            let screenY = cursorY * cellHeight + this.padding

            if (this.cursor.style === 'block') {
              // block
              ctx.rect(screenX, screenY, cursorWidth, cellHeight)
            } else if (this.cursor.style === 'bar') {
              // vertical bar
              let barWidth = 2
              ctx.rect(screenX, screenY, barWidth, cellHeight)
            } else if (this.cursor.style === 'line') {
              // underline
              let lineHeight = 2
              ctx.rect(screenX, screenY + charSize.height, cursorWidth, lineHeight)
            }
            ctx.clip()

            // swap foreground/background
            ;[fg, bg] = [bg, fg]

            // HACK: ensure cursor is visible
            if (fg === bg) bg = fg === 0 ? 7 : 0

            this.drawBackground({ x: cursorX, y: cursorY, cellWidth, cellHeight, bg })
            this.drawCharacter({
              x: cursorX, y: cursorY, charSize, cellWidth, cellHeight, text, fg, attrs
            })
            ctx.restore()
          }
        }
      }
    }

    if (this.graphics >= 1) ctx.restore()

    if (this.debug && this._debug) this._debug.drawEnd()

    this.emit('draw', why)
  }

  drawStatus (statusScreen) {
    const { ctx, width, height, devicePixelRatio } = this

    // reset drawnScreen to force redraw when statusScreen is disabled
    this.drawnScreen = []

    const cellSize = this.cellSize
    const screenWidth = width * cellSize.width + 2 * this.padding
    const screenHeight = height * cellSize.height + 2 * this.padding

    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    ctx.fillStyle = this.getColor(this.defaultBG)
    ctx.fillRect(0, 0, screenWidth, screenHeight)

    ctx.font = `24px ${this.statusFont}`
    ctx.fillStyle = this.getColor(this.defaultFG)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(statusScreen.title || '', screenWidth / 2, screenHeight / 2 - 50)

    if (statusScreen.loading) {
      // show loading spinner
      ctx.save()
      ctx.translate(screenWidth / 2, screenHeight / 2 + 20)

      ctx.strokeStyle = this.getColor(this.defaultFG)
      ctx.lineWidth = 5
      ctx.lineCap = 'round'

      let t = Date.now() / 1000

      for (let i = 0; i < 12; i++) {
        ctx.rotate(Math.PI / 6)
        let offset = ((t * 12) - i) % 12
        ctx.globalAlpha = Math.max(0.2, 1 - offset / 3)
        ctx.beginPath()
        ctx.moveTo(0, 15)
        ctx.lineTo(0, 30)
        ctx.stroke()
      }

      ctx.restore()
    }
  }

  startDrawLoop () {
    if (this._drawTimerThread) return
    let threadID = Math.random().toString(36)
    this._drawTimerThread = threadID
    this.drawTimerLoop(threadID)
  }

  stopDrawLoop () {
    this._drawTimerThread = null
  }

  drawTimerLoop (threadID) {
    if (!threadID || threadID !== this._drawTimerThread) return
    window.requestAnimationFrame(() => this.drawTimerLoop(threadID))
    this.draw('draw-loop')
  }

  /**
   * Converts an alphabetic character to its fraktur variant.
   * @param {string} character - the character
   * @returns {string} the converted character
   */
  static alphaToFraktur (character) {
    if (character >= 'a' && character <= 'z') {
      character = String.fromCodePoint(0x1d51e - 0x61 + character.charCodeAt(0))
    } else if (character >= 'A' && character <= 'Z') {
      character = frakturExceptions[character] || String.fromCodePoint(0x1d504 - 0x41 + character.charCodeAt(0))
    }
    return character
  }
}
