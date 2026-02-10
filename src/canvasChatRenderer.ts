import { getColorShadow, messageFormatStylesMap } from './react/MessageFormatted'
import { getCanvasChatMessages, getMessageOpacity, getChatLayout, updateMessageAnimation, CanvasChatMessage } from './canvasChatMessages'
import type { MessageFormatPart } from './chatUtils'
import { appQueryParams } from './appParams'


// Check if canvas chat is enabled (defaults to false, can be enabled with ?chat=true)
export function isChatCanvasEnabled (): boolean {
  return appQueryParams.chat === 'true'
}

// Rendering constants
const BASE_FONT_SIZE = 16
const LINE_HEIGHT = 32
const PADDING_LEFT = 20
const PADDING_BOTTOM = 100 // Above hotbar
const MAX_VISIBLE_MESSAGES = 10
const SHADOW_OFFSET = 1

// Overlay canvas for 2D chat rendering (WebGL canvas can't use 2D context)
let overlayCanvas: HTMLCanvasElement | null = null
let overlayCtx: CanvasRenderingContext2D | null = null

// Image cache for provider logos
const logoCache = new Map<string, HTMLImageElement | 'loading' | 'failed'>()

function loadLogoImage (url: string): HTMLImageElement | null {
  const cached = logoCache.get(url)
  if (cached === 'loading' || cached === 'failed') return null
  if (cached) return cached

  // Start loading
  logoCache.set(url, 'loading')
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    logoCache.set(url, img)
  }
  img.onerror = () => {
    logoCache.set(url, 'failed')
  }
  img.src = url
  return null
}

// Preload all provider logos at startup
function preloadAllLogos (): void {
  for (const provider of PROVIDER_NAMES) {
    const url = providerLogo(provider)
    if (url) {
      loadLogoImage(url)
    }
  }
}

function getOrCreateOverlayCanvas (): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const gameCanvas = document.getElementById('viewer-canvas') as HTMLCanvasElement
  if (!gameCanvas) return null

  if (!overlayCanvas) {
    overlayCanvas = document.createElement('canvas')
    overlayCanvas.id = 'chat-overlay-canvas'
    overlayCanvas.style.position = 'fixed'
    overlayCanvas.style.top = '0'
    overlayCanvas.style.left = '0'
    overlayCanvas.style.width = '100%'
    overlayCanvas.style.height = '100%'
    overlayCanvas.style.pointerEvents = 'none'
    overlayCanvas.style.zIndex = '1' // Above WebGL canvas but below UI
    document.body.appendChild(overlayCanvas)
    overlayCtx = overlayCanvas.getContext('2d')
  }

  // Sync size with game canvas
  if (overlayCanvas.width !== gameCanvas.width || overlayCanvas.height !== gameCanvas.height) {
    overlayCanvas.width = gameCanvas.width
    overlayCanvas.height = gameCanvas.height
  }

  if (!overlayCtx) return null
  return { canvas: overlayCanvas, ctx: overlayCtx }
}

// Color mapping from messageFormatStylesMap - extract hex values
const colorMap: Record<string, string> = {}
for (const [key, value] of Object.entries(messageFormatStylesMap)) {
  if (value.startsWith('color:')) {
    colorMap[key] = value.replace('color:', '')
  }
}

// Default color if not found
const DEFAULT_COLOR = '#FFFFFF'

// Provider names to detect (keys from providerLogo)
const PROVIDER_NAMES = [
  'google', 'gemini', 'anthropic', 'claude', 'openai', 'amazon', 'arcee-ai',
  'ai21', 'aion-labs', 'alfredpros', 'allenai', 'openrouter', 'baidu',
  'bytedance', 'deepcogito', 'cohere', 'deepseek', 'eva-unit-01', 'inception',
  'inflection', 'liquid', 'alpindale', 'anthracite-org', 'mancer', 'meituan',
  'meta-llama', 'microsoft', 'mistralai', 'moonshotai', 'gryphe', 'nvidia',
  'neversleep', 'nousresearch', 'perplexity', 'qwen', 'undi95', 'sao10k',
  'raifle', 'stepfun-ai', 'thudm', 'tngtech', 'tencent', 'thedrummer',
  'cognitivecomputations', 'z-ai', 'x-ai', 'grok'
]

function detectProviderInMessage (parts: MessageFormatPart[]): string | null {
  // Get full message text
  const fullText = parts.map(p => p.text || '').join('').toLowerCase()

  // Check if any provider name appears in the message
  for (const provider of PROVIDER_NAMES) {
    // Match provider name as a word (with word boundaries)
    const regex = new RegExp(`\\b${provider.replace('-', '[-]?')}\\b`, 'i')
    if (regex.test(fullText)) {
      return provider
    }
  }
  return null
}

function getColor (colorName: string | undefined): string {
  if (!colorName) return DEFAULT_COLOR
  // Handle direct hex colors
  if (colorName.startsWith('#')) return colorName
  // Look up named color
  return colorMap[colorName.toLowerCase()] ?? DEFAULT_COLOR
}

function buildFontString (part: MessageFormatPart, fontSize: number): string {
  const styles: string[] = []

  if (part.italic) {
    styles.push('italic')
  }
  if (part.bold) {
    styles.push('bold')
  }

  styles.push(`${fontSize}px`, 'mojangles, monospace')

  return styles.join(' ')
}

/**
 * Extract username from message parts.
 * With format "%s %s", the username is the first non-empty/whitespace part.
 */
function extractUsername (parts: MessageFormatPart[]): { username: string; part: MessageFormatPart } | null {
  for (const part of parts) {
    if (part.text?.trim()) {
      return { username: part.text.trim(), part }
    }
  }
  return null
}

/**
 * Measure the width of the username text.
 */
function measureUsernameWidth (ctx: CanvasRenderingContext2D, parts: MessageFormatPart[], fontSize: number): number {
  const usernameInfo = extractUsername(parts)
  if (!usernameInfo) return 0

  ctx.font = buildFontString(usernameInfo.part, fontSize)
  return ctx.measureText(usernameInfo.username).width + 4
}

/**
 * Get the message text after the username (for stacked layout).
 */
function getMessageTextAfterUsername (parts: MessageFormatPart[]): MessageFormatPart[] {
  let foundUsername = false
  const result: MessageFormatPart[] = []

  for (const part of parts) {
    if (!foundUsername && part.text?.trim()) {
      // This is the username, skip it but include any trailing space
      foundUsername = true
      continue
    }
    if (foundUsername) {
      result.push(part)
    }
  }

  return result
}

/**
 * Measure the total width of message parts.
 */
function measurePartsWidth (ctx: CanvasRenderingContext2D, parts: MessageFormatPart[], fontSize: number): number {
  let width = 0
  for (const part of parts) {
    if (!part.text) continue
    ctx.font = buildFontString(part, fontSize)
    width += ctx.measureText(part.text).width
  }
  return width
}

// eslint-disable-next-line max-params
function renderMessageLine (
  ctx: CanvasRenderingContext2D,
  parts: MessageFormatPart[],
  x: number,
  y: number,
  fontSize: number,
  opacity: number
): void {
  let currentX = x

  for (const part of parts) {
    if (!part.text) continue

    ctx.font = buildFontString(part, fontSize)
    const color = getColor(part.color)
    const shadowColor = getColorShadow(color)

    // Draw shadow first
    ctx.fillStyle = shadowColor
    ctx.globalAlpha = opacity
    ctx.fillText(part.text, currentX + SHADOW_OFFSET, y + SHADOW_OFFSET)

    // Draw main text
    ctx.fillStyle = color
    ctx.globalAlpha = opacity
    ctx.fillText(part.text, currentX, y)

    // Handle strikethrough
    if (part.strikethrough) {
      const textWidth = ctx.measureText(part.text).width
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(currentX, y - fontSize * 0.3)
      ctx.lineTo(currentX + textWidth, y - fontSize * 0.3)
      ctx.stroke()
    }

    // Handle underline
    if (part.underlined) {
      const textWidth = ctx.measureText(part.text).width
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(currentX, y + 2)
      ctx.lineTo(currentX + textWidth, y + 2)
      ctx.stroke()
    }

    currentX += ctx.measureText(part.text).width
  }

  ctx.globalAlpha = 1
}

// Max characters per line for Minecraft layout wrapping
const MINECRAFT_MAX_CHARS_PER_LINE = 76

// eslint-disable-next-line max-params
function renderMinecraftLayout (
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  messagesToRender: Array<{ msg: CanvasChatMessage; opacity: number }>,
  scaleFactor: number
): void {
  const fontSize = Math.round(BASE_FONT_SIZE * scaleFactor)
  const lineHeight = Math.round(LINE_HEIGHT * scaleFactor)
  const paddingBottom = Math.round(PADDING_BOTTOM * scaleFactor)
  const paddingLeft = Math.round(PADDING_LEFT * scaleFactor)

  ctx.textBaseline = 'top'

  const iconSize = Math.round(fontSize * 1.1)
  const iconPadding = Math.round(fontSize * 0.3)

  const badgePaddingX = Math.round(fontSize * 0.3)
  const badgePaddingY = Math.round(fontSize * 0.3)
  const badgeBorderRadius = 4

  // Pre-calculate wrapped lines for each message
  const messagesWithWrappedLines: Array<{
    msg: CanvasChatMessage
    opacity: number
    wrappedLines: MessageFormatPart[][]
    provider: string | null
    logoImg: HTMLImageElement | null
    usernameWidth: number
  }> = []

  let totalLineCount = 0
  for (const { msg, opacity } of messagesToRender) {
    const wrappedLines = wrapMessagePartsByCharCount(msg.parts, MINECRAFT_MAX_CHARS_PER_LINE)
    const provider = detectProviderInMessage(msg.parts)
    const logoImg = provider ? loadLogoImage(providerLogo(provider) ?? '') : null
    const usernameWidth = measureUsernameWidth(ctx, msg.parts, fontSize)

    messagesWithWrappedLines.push({
      msg,
      opacity,
      wrappedLines,
      provider,
      logoImg,
      usernameWidth
    })
    totalLineCount += wrappedLines.length
  }

  // Calculate starting Y position (bottom-up rendering based on total lines)
  const startY = canvasHeight - paddingBottom - (totalLineCount - 1) * lineHeight

  let currentLineIndex = 0
  for (const { opacity, wrappedLines, logoImg, usernameWidth } of messagesWithWrappedLines) {
    const hasLogo = !!logoImg
    const logoTotalWidth = hasLogo ? iconSize + iconPadding : 0
    const badgeContentWidth = logoTotalWidth + usernameWidth
    const badgeWidth = badgeContentWidth + badgePaddingX * 2
    const badgeHeight = iconSize + badgePaddingY * 2

    for (const [lineIndex, lineParts] of wrappedLines.entries()) {
      const y = startY + currentLineIndex * lineHeight
      let xOffset = paddingLeft

      // Only draw badge and logo on the first line of a message
      if (lineIndex === 0) {
        const badgeY = y - (iconSize - fontSize) / 2 - badgePaddingY

        // Draw 30% opacity background rectangle for logo + username
        if (usernameWidth > 0) {
          ctx.save()
          ctx.globalAlpha = opacity * 0.3
          ctx.fillStyle = '#000000'
          ctx.beginPath()
          ctx.roundRect(xOffset - badgePaddingX, badgeY, badgeWidth, badgeHeight, badgeBorderRadius)
          ctx.fill()
          ctx.restore()
        }

        // Draw logo if present
        if (logoImg) {
          ctx.globalAlpha = opacity
          const logoY = y - (iconSize - fontSize) / 2
          const logoBorderRadius = 2

          ctx.save()

          // Draw white rounded rectangle background for logo
          ctx.fillStyle = '#FFFFFF'
          ctx.beginPath()
          ctx.roundRect(xOffset, logoY, iconSize, iconSize, logoBorderRadius)
          ctx.fill()

          // Clip to rounded rectangle and draw logo
          ctx.beginPath()
          ctx.roundRect(xOffset, logoY, iconSize, iconSize, logoBorderRadius)
          ctx.clip()
          ctx.drawImage(logoImg, xOffset, logoY, iconSize, iconSize)

          ctx.restore()

          xOffset += iconSize + iconPadding
        }
      }

      renderMessageLine(ctx, lineParts, xOffset, y, fontSize, opacity)
      currentLineIndex++
    }
  }
}

// Stacked layout constants
const STACKED_CARD_PADDING = 12
const STACKED_CARD_GAP = 8
const STACKED_CARD_BORDER_RADIUS = 8
const STACKED_PADDING_RIGHT = 20
const STACKED_PADDING_BOTTOM = 100
const STACKED_CARD_WIDTH = 300 // Fixed width

/**
 * Wrap message parts by character count (for Minecraft layout).
 * Wraps at maxChars, breaking at nearest whitespace under the limit.
 */
function wrapMessagePartsByCharCount (
  parts: MessageFormatPart[],
  maxChars: number
): MessageFormatPart[][] {
  const lines: MessageFormatPart[][] = []
  let currentLine: MessageFormatPart[] = []
  let currentLineLength = 0

  for (const part of parts) {
    if (!part.text) continue

    const words = part.text.split(/(\s+)/) // Split keeping whitespace

    for (const word of words) {
      if (!word) continue

      const wordLength = word.length

      // If this word would exceed the line length
      if (currentLineLength + wordLength > maxChars && currentLine.length > 0) {
        // Start a new line
        lines.push(currentLine)
        currentLine = []
        currentLineLength = 0
      }

      // Add word to current line (as a new part with same styling)
      if (word.trim() || currentLineLength > 0) { // Don't start line with whitespace
        currentLine.push({ ...part, text: word })
        currentLineLength += wordLength
      }
    }
  }

  // Don't forget the last line
  if (currentLine.length > 0) {
    lines.push(currentLine)
  }

  return lines.length > 0 ? lines : [[]]
}

/**
 * Wrap message parts to fit within maxWidth.
 * Returns array of lines, each line is an array of parts.
 */
function wrapMessageParts (
  ctx: CanvasRenderingContext2D,
  parts: MessageFormatPart[],
  fontSize: number,
  maxWidth: number
): MessageFormatPart[][] {
  const lines: MessageFormatPart[][] = []
  let currentLine: MessageFormatPart[] = []
  let currentLineWidth = 0

  for (const part of parts) {
    if (!part.text) continue

    ctx.font = buildFontString(part, fontSize)
    const words = part.text.split(/(\s+)/) // Split keeping whitespace

    for (const word of words) {
      if (!word) continue

      const wordWidth = ctx.measureText(word).width

      // If this word would exceed the line width
      if (currentLineWidth + wordWidth > maxWidth && currentLine.length > 0) {
        // Start a new line
        lines.push(currentLine)
        currentLine = []
        currentLineWidth = 0
      }

      // Add word to current line (as a new part with same styling)
      if (word.trim() || currentLineWidth > 0) { // Don't start line with whitespace
        currentLine.push({ ...part, text: word })
        currentLineWidth += wordWidth
      }
    }
  }

  // Don't forget the last line
  if (currentLine.length > 0) {
    lines.push(currentLine)
  }

  return lines.length > 0 ? lines : [[]]
}

// eslint-disable-next-line max-params
function renderStackedLayout (
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  messagesToRender: Array<{ msg: CanvasChatMessage; opacity: number }>,
  scaleFactor: number
): void {
  const fontSize = Math.round(BASE_FONT_SIZE * scaleFactor)
  const cardPadding = Math.round(STACKED_CARD_PADDING * scaleFactor)
  const cardGap = Math.round(STACKED_CARD_GAP * scaleFactor)
  const cardBorderRadius = Math.round(STACKED_CARD_BORDER_RADIUS * scaleFactor)
  const paddingRight = Math.round(STACKED_PADDING_RIGHT * scaleFactor)
  const paddingBottom = Math.round(STACKED_PADDING_BOTTOM * scaleFactor)
  const cardWidth = Math.round(STACKED_CARD_WIDTH * scaleFactor)

  const iconSize = Math.round(fontSize * 1.2)
  const iconPadding = Math.round(fontSize * 0.4)
  const lineSpacing = Math.round(fontSize * 0.3)
  const messageLineHeight = Math.round(fontSize * 1.3)

  ctx.textBaseline = 'top'

  // Calculate available width for message text
  const messageMaxWidth = cardWidth - cardPadding * 2

  // Calculate card heights and positions from bottom up
  // We need to measure each card first to know where to position them
  const cardMeasurements: Array<{
    msg: CanvasChatMessage
    opacity: number
    cardHeight: number
    usernameInfo: { username: string; part: MessageFormatPart } | null
    wrappedLines: MessageFormatPart[][]
    provider: string | null
    logoImg: HTMLImageElement | null
  }> = []

  for (const { msg, opacity } of messagesToRender) {
    const provider = detectProviderInMessage(msg.parts)
    const logoImg = provider ? loadLogoImage(providerLogo(provider) ?? '') : null
    const usernameInfo = extractUsername(msg.parts)
    const messageText = getMessageTextAfterUsername(msg.parts)

    // Wrap message to fit card width
    const wrappedLines = wrapMessageParts(ctx, messageText, fontSize, messageMaxWidth)

    // Card has: logo + username on first line, wrapped message below
    const headerHeight = iconSize
    const messageHeight = wrappedLines.length * messageLineHeight
    const cardHeight = cardPadding + headerHeight + lineSpacing + messageHeight + cardPadding

    cardMeasurements.push({
      msg,
      opacity,
      cardHeight,
      usernameInfo,
      wrappedLines,
      provider,
      logoImg
    })
  }

  // First pass: calculate all target Y positions
  const targetPositions: number[] = []
  let calcY = canvasHeight - paddingBottom
  for (let i = cardMeasurements.length - 1; i >= 0; i--) {
    const targetY = calcY - cardMeasurements[i].cardHeight
    targetPositions[i] = targetY
    calcY = targetY - cardGap
  }

  // Second pass: render with animation
  for (let i = cardMeasurements.length - 1; i >= 0; i--) {
    const card = cardMeasurements[i]
    const { msg, opacity, cardHeight, usernameInfo, wrappedLines, logoImg } = card

    // Get target Y and animate toward it
    const targetY = targetPositions[i]
    const animatedY = updateMessageAnimation(msg, targetY)

    // Position from right edge (fixed width)
    const cardX = canvasWidth - paddingRight - cardWidth

    // Draw card background (30% opacity black)
    ctx.save()
    ctx.globalAlpha = opacity * 0.3
    ctx.fillStyle = '#000000'
    ctx.beginPath()
    ctx.roundRect(cardX, animatedY, cardWidth, cardHeight, cardBorderRadius)
    ctx.fill()
    ctx.restore()

    // Draw content
    let contentX = cardX + cardPadding
    const contentY = animatedY + cardPadding

    // Draw logo if present
    if (logoImg) {
      ctx.globalAlpha = opacity
      const logoBorderRadius = 2

      ctx.save()

      // Draw white rounded rectangle background for logo
      ctx.fillStyle = '#FFFFFF'
      ctx.beginPath()
      ctx.roundRect(contentX, contentY, iconSize, iconSize, logoBorderRadius)
      ctx.fill()

      // Clip to rounded rectangle and draw logo
      ctx.beginPath()
      ctx.roundRect(contentX, contentY, iconSize, iconSize, logoBorderRadius)
      ctx.clip()
      ctx.drawImage(logoImg, contentX, contentY, iconSize, iconSize)

      ctx.restore()

      contentX += iconSize + iconPadding
    }

    // Draw username
    if (usernameInfo) {
      ctx.font = buildFontString(usernameInfo.part, fontSize)
      const color = getColor(usernameInfo.part.color)
      const shadowColor = getColorShadow(color)

      // Center username vertically with icon
      const usernameY = contentY + (iconSize - fontSize) / 2

      ctx.globalAlpha = opacity
      ctx.fillStyle = shadowColor
      ctx.fillText(usernameInfo.username, contentX + SHADOW_OFFSET, usernameY + SHADOW_OFFSET)
      ctx.fillStyle = color
      ctx.fillText(usernameInfo.username, contentX, usernameY)
    }

    // Draw wrapped message lines
    let messageY = animatedY + cardPadding + iconSize + lineSpacing
    for (const line of wrappedLines) {
      renderMessageLine(ctx, line, cardX + cardPadding, messageY, fontSize, opacity)
      messageY += messageLineHeight
    }
  }

  ctx.globalAlpha = 1
}

export function renderChatOnCanvas (): void {
  // Check if chat canvas is disabled via appParams
  if (!isChatCanvasEnabled()) {
    // Clear the overlay canvas if it exists (in case it was just disabled)
    if (overlayCanvas && overlayCtx) {
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height)
    }
    return
  }

  const overlay = getOrCreateOverlayCanvas()
  if (!overlay) return

  const { canvas, ctx } = overlay
  const canvasWidth = canvas.width
  const canvasHeight = canvas.height

  // Clear the overlay canvas
  ctx.clearRect(0, 0, canvasWidth, canvasHeight)

  const messages = getCanvasChatMessages()

  // Filter to only visible messages (opacity > 0)
  const visibleMessages: Array<{ msg: CanvasChatMessage; opacity: number }> = []
  for (const msg of messages) {
    const opacity = getMessageOpacity(msg)
    if (opacity > 0) {
      visibleMessages.push({ msg, opacity })
    }
  }

  // Take only the last N visible messages
  const messagesToRender = visibleMessages.slice(-MAX_VISIBLE_MESSAGES)

  if (messagesToRender.length === 0) return

  // Scale based on canvas size (baseline: 800px height)
  const scaleFactor = Math.max(1, canvasHeight / 800)

  const layout = getChatLayout()
  if (layout === 'stacked') {
    renderStackedLayout(ctx, canvasWidth, canvasHeight, messagesToRender, scaleFactor)
  } else {
    renderMinecraftLayout(ctx, canvasWidth, canvasHeight, messagesToRender, scaleFactor)
  }
}


export function providerLogo (provider: string): string | null {
  const providerLogoURLs: Record<string, string> = {
    google: 'https://openrouter.ai/images/icons/GoogleGemini.svg',
    gemini: 'https://openrouter.ai/images/icons/GoogleGemini.svg',
    anthropic:
      'https://firebasestorage.googleapis.com/v0/b/kradle-prod-storage/o/public%2Fdefaults%2Fanthropic.svg?alt=media',
    claude:
      'https://firebasestorage.googleapis.com/v0/b/kradle-prod-storage/o/public%2Fdefaults%2Fanthropic.svg?alt=media',
    openai: 'https://openrouter.ai/images/icons/OpenAI.svg',
    amazon: 'https://openrouter.ai/images/icons/Bedrock.svg',
    'arcee-ai':
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://arcee.ai/&size=256',
    ai21: 'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://ai21.com/&size=256',
    'aion-labs':
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://www.aionlabs.ai/&size=256',
    alfredpros:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://huggingface.co/&size=256',
    allenai:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://allenai.org/&size=256',
    openrouter:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://openrouter.ai/&size=256',
    baidu:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://www.baidu.com/&size=256',
    bytedance:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://huggingface.co/&size=256',
    deepcogito:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://www.deepcogito.com/&size=256',
    cohere: 'https://openrouter.ai/images/icons/Cohere.png',
    deepseek: 'https://openrouter.ai/images/icons/DeepSeek.png',
    'eva-unit-01': 'https://openrouter.ai/images/icons/Qwen.png',
    inception:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://www.inceptionlabs.ai/&size=256',
    inflection:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://inflection.ai/&size=256',
    liquid:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://www.liquid.ai/&size=256',
    alpindale:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://huggingface.co/&size=256',
    'anthracite-org':
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://huggingface.co/&size=256',
    mancer:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://huggingface.co/&size=256',
    meituan:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://huggingface.co/&size=256',
    'meta-llama':
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://ai.meta.com/&size=256',
    microsoft: 'https://openrouter.ai/images/icons/Microsoft.svg',
    mistralai: 'https://openrouter.ai/images/icons/Mistral.png',
    moonshotai:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://moonshot.ai&size=256',
    gryphe:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://huggingface.co/&size=256',
    nvidia:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://nvidia.com/&size=256',
    neversleep:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://huggingface.co/&size=256',
    nousresearch:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://nousresearch.com/&size=256',
    perplexity: 'https://openrouter.ai/images/icons/Perplexity.svg',
    qwen: 'https://openrouter.ai/images/icons/Qwen.png',
    undi95:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://nousresearch.com/&size=256',
    sao10k:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://huggingface.co/&size=256',
    raifle:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://huggingface.co/&size=256',
    'stepfun-ai':
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://huggingface.co/&size=256',
    thudm:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://z.ai/&size=256',
    tngtech:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://huggingface.co/&size=256',
    tencent:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://huggingface.co/&size=256',
    thedrummer: 'https://openrouter.ai/images/icons/TheDrummer.png',
    cognitivecomputations:
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://huggingface.co/&size=256',
    'z-ai':
      'https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://z.ai/&size=256',
    'x-ai': 'https://firebasestorage.googleapis.com/v0/b/kradle-prod-storage/o/public%2Fdefaults%2Fxai.svg?alt=media',
    grok: 'https://firebasestorage.googleapis.com/v0/b/kradle-prod-storage/o/public%2Fdefaults%2Fxai.svg?alt=media'
  }

  try {
    return providerLogoURLs[provider]
  } catch {
    return null
  }
}

// Preload all logos on module load
preloadAllLogos()
