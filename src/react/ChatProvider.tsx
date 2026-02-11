import { useEffect, useMemo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { appQueryParams } from '../appParams'
import { formatMessage } from '../chatUtils'
import { addCanvasChatMessage, clearCanvasChatMessages } from '../canvasChatMessages'
import { isChatCanvasEnabled } from '../canvasChatRenderer'
import { getBuiltinCommandsList, tryHandleBuiltinCommand } from '../builtinCommands'
import { gameAdditionalState, hideCurrentModal, miscUiState } from '../globalState'
import { options } from '../optionsStorage'
import { viewerVersionState } from '../viewerConnector'
import Chat, { Message, fadeMessage } from './Chat'
import { useIsModalActive } from './utilsApp'
import { hideNotification, showNotification } from './NotificationProvider'
import { updateLoadedServerData } from './serversStorage'
import { lastConnectOptions } from './AppStatusProvider'
import { packetsReplayState } from './state/packetsReplayState'

// Track all chat messages for kradleverse mode
const allChatMessages: Array<{ parts: Array<{ text: string; color?: string; bold?: boolean; italic?: boolean }>; id: number }> = []

// Track seen message content hashes to prevent duplicates
const seenMessageHashes = new Set<string>()

// Flag to skip chat during fast-forward (module-level for synchronous access)
let skipChatMessages = false

export function setSkipChatMessages (skip: boolean) {
  skipChatMessages = skip
}

// Generate a hash from message parts for deduplication
function getMessageHash (parts: any[]): string {
  return parts.map(p => p.text || '').join('|')
}

// Sanitize message parts to only include serializable properties
function sanitizeParts (parts: any[]): Array<{ text: string; color?: string; bold?: boolean; italic?: boolean }> {
  return parts.map(part => ({
    text: part.text || '',
    ...(part.color && { color: part.color }),
    ...(part.bold && { bold: part.bold }),
    ...(part.italic && { italic: part.italic })
  }))
}

function sendChatToParent () {
  if (appQueryParams.kradleverse && window !== window.parent) {
    window.parent.postMessage({
      source: 'minecraft-web-client',
      action: 'chatMessages',
      messages: [...allChatMessages]
    }, '*')
  }
}

// Synchronous clear function that can be called directly before fast-forwarding
export function clearKradleverseChat () {
  allChatMessages.length = 0
  seenMessageHashes.clear()
  clearCanvasChatMessages()
  sendChatToParent()
}

// Player chat translate keys (format: "<player> message" or "* player message")
// Includes both legacy translation keys and raw chat registry decoration formats (1.20.4+)
const PLAYER_CHAT_TRANSLATE_KEYS = new Set([
  'chat.type.text', // <player> message
  'chat.type.emote', // * player message
  'chat.type.announcement', // [player] message (broadcasts)
  'chat.type.team.text', // team chat
  'chat.type.team.sent', // team chat sent
  '<%s> %s', // 1.20.4+ raw chat registry format for player chat
  '* %s %s', // 1.20.4+ raw chat registry format for emote
  '[%s] %s', // 1.20.4+ raw chat registry format for announcement
])

// System message translate key prefixes to exclude from canvas rendering
const EXCLUDED_TRANSLATE_PREFIXES = [
  'chat.type.advancement', // advancement messages
  'death.', // death messages
  'multiplayer.player.joined', // player joined
  'multiplayer.player.left', // player left
]

// Check if message text starts with [ (bracketed messages to filter out)
function startsWithBracket (parts: Array<{ text: string }>): boolean {
  const fullText = parts.map(p => p.text || '').join('').trim()
  return fullText.startsWith('[')
}

// Check if message text starts with "Teleported " (teleport confirmations to filter out)
function startsWithTeleported (parts: Array<{ text: string }>): boolean {
  const fullText = parts.map(p => p.text || '').join('').trim()
  return fullText.startsWith('Teleported ')
}

function isPlayerChatMessage (jsonMsg: any): boolean {
  const translate = jsonMsg?.translate || jsonMsg?.json?.translate

  // Exclude system messages by prefix
  if (translate) {
    for (const prefix of EXCLUDED_TRANSLATE_PREFIXES) {
      if (translate.startsWith(prefix)) {
        return false
      }
    }
  }

  if (translate && PLAYER_CHAT_TRANSLATE_KEYS.has(translate)) {
    return true
  }
  // Also check if message has 'with' array containing player info (common pattern)
  // Messages without translate but with text and clickEvent for player name are likely player chat
  if (jsonMsg?.with && Array.isArray(jsonMsg.with) && jsonMsg.with.length >= 2) {
    const firstWith = jsonMsg.with[0]
    // Player names often have clickEvent with suggest_command
    if (firstWith?.clickEvent?.action === 'suggest_command') {
      return true
    }
  }
  return false
}


export default () => {
  const [messages, setMessages] = useState([] as Message[])
  const isChatActive = useIsModalActive('chat')
  const { messagesLimit, chatOpacity, chatOpacityOpened } = options
  const lastMessageId = useRef(0)
  const usingTouch = useSnapshot(miscUiState).currentTouch
  const { chatSelect } = useSnapshot(options)
  const isUsingMicrosoftAuth = useMemo(() => !!lastConnectOptions.value?.authenticatedAccount, [])
  const { forwardChat } = useSnapshot(viewerVersionState)
  const { viewerConnection } = useSnapshot(gameAdditionalState)

  useEffect(() => {
    bot.addListener('message', (jsonMsg, position) => {
      if (position === 'game_info') return // ignore action bar messages, they are handled by the TitleProvider
      if (jsonMsg['unsigned']) {
        jsonMsg = jsonMsg['unsigned']
      }
      const parts = formatMessage(jsonMsg)

      // Skip chat messages during fast-forward to prevent duplicates
      if (skipChatMessages) {
        return
      }

      // Only show player chat messages on canvas (not system messages)
      // Also filter out messages starting with [ (system/watcher messages) or "Teleported " (teleport confirmations)
      const isPlayerChat = isPlayerChatMessage(jsonMsg) && !startsWithBracket(parts) && !startsWithTeleported(parts)
      if (isChatCanvasEnabled() && isPlayerChat) {
        addCanvasChatMessage(parts)
      }

      setMessages(m => {
        lastMessageId.current++
        const newMessage: Message = {
          parts,
          id: lastMessageId.current,
          faded: false,
        }
        fadeMessage(newMessage, true, () => {
          // eslint-disable-next-line max-nested-callbacks
          setMessages(m => [...m])
        })

        // Track and send chat to parent in kradleverse mode (only player chat messages)
        if (isPlayerChat) {
          const hash = getMessageHash(parts)
          // Skip duplicate messages
          if (!seenMessageHashes.has(hash)) {
            seenMessageHashes.add(hash)
            allChatMessages.push({ parts: sanitizeParts(parts), id: lastMessageId.current })
            sendChatToParent()
          }
        }

        return [...m, newMessage].slice(-messagesLimit)
      })
    })

    // Clear chat on seek/restart
    customEvents.on('clearChat', () => {
      setMessages([])
      lastMessageId.current = 0
      clearCanvasChatMessages()
      // Clear tracked messages and notify parent
      allChatMessages.length = 0
      sendChatToParent()
    })

    return () => {
      customEvents.off('clearChat', () => {})
    }
  }, [])

  return <Chat
    allowSelection={chatSelect}
    usingTouch={!!usingTouch}
    opacity={(isChatActive ? chatOpacityOpened : chatOpacity) / 100}
    messages={messages}
    opened={isChatActive}
    placeholder={forwardChat || !viewerConnection ? undefined : 'Chat forwarding is not enabled in the plugin settings'}
    sendMessage={(message) => {
      const builtinHandled = tryHandleBuiltinCommand(message)
      if (miscUiState.loadedServerIndex && (message.startsWith('/login') || message.startsWith('/register'))) {
        showNotification('Click here to save your password in browser for auto-login', undefined, false, undefined, () => {
          updateLoadedServerData((server) => {
            server.autoLogin ??= {}
            const password = message.split(' ')[1]
            server.autoLogin[bot.player.username] = password
            return server
          })
          hideNotification()
        })
      }
      if (!builtinHandled) {
        bot.chat(message)
      }
    }}
    onClose={() => {
      hideCurrentModal()
    }}
    fetchCompletionItems={async (triggerKind, completeValue) => {
      if ((triggerKind === 'explicit' || options.autoRequestCompletions)) {
        let items = [] as string[]
        try {
          items = await bot.tabComplete(completeValue, true, true)
        } catch (err) { }
        if (typeof items[0] === 'object') {
          // @ts-expect-error
          if (items[0].match) items = items.map(i => i.match)
        }
        if (completeValue === '/') {
          if (!items[0]?.startsWith('/')) {
            // normalize
            items = items.map(item => `/${item}`)
          }
          if (items.length) {
            items = [...items, ...getBuiltinCommandsList()]
          }
        }
        return items
      }
    }}
  />
}
