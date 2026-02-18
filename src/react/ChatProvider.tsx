import { useEffect, useMemo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { getThreeJsRendererMethods } from 'renderer/viewer/three/threeJsMethods'
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

export type ChatMessageType = 'chat' | 'death' | 'join' | 'leave' | 'teleport' | 'title' | 'subtitle' | 'announcement' | 'kradle_command'

// Track all chat messages for kradleverse mode
const allChatMessages: Array<{ parts: Array<{ text: string; color?: string; bold?: boolean; italic?: boolean }>; id: number; type: ChatMessageType }> = []

// Track seen message content hashes to prevent duplicates
const seenMessageHashes = new Set<string>()

let nextMessageId = 0

// Flag to skip chat during fast-forward (module-level for synchronous access)
let skipChatMessages = false

export function setSkipChatMessages (skip: boolean) {
  skipChatMessages = skip
}

function getMessageHash (parts: any[]): string {
  return parts.map(p => p.text || '').join('|')
}

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

export function sendMessageToParent (parts: any[], type: ChatMessageType) {
  const text = parts.map(p => p.text || '').join('')
  console.log(`[chat:${type}]`, text)
  if (!appQueryParams.kradleverse || window === window.parent) return
  if (skipChatMessages) return
  const hash = `${type}|${getMessageHash(parts)}`
  if (seenMessageHashes.has(hash)) return
  seenMessageHashes.add(hash)
  nextMessageId++
  allChatMessages.push({ parts: sanitizeParts(parts), id: nextMessageId, type })
  sendChatToParent()
}

// Synchronous clear function that can be called directly before fast-forwarding
export function clearKradleverseChat () {
  allChatMessages.length = 0
  seenMessageHashes.clear()
  nextMessageId = 0
  clearCanvasChatMessages()
  sendChatToParent()
}

const PLAYER_CHAT_TRANSLATE_KEYS = new Set([
  'chat.type.text',
  'chat.type.emote',
  'chat.type.announcement',
  'chat.type.team.text',
  'chat.type.team.sent',
  '<%s> %s',
  '* %s %s',
  '[%s] %s',
])

function classifyMessage (jsonMsg: any, parts: Array<{ text: string }>): ChatMessageType | null {
  const translate: string | undefined = jsonMsg?.translate ?? jsonMsg?.json?.translate
  const fullText = parts.map(p => p.text || '').join('').trim()

  if (translate) {
    if (translate.startsWith('death.')) return 'death'
    if (translate.startsWith('multiplayer.player.joined')) {
      return parts[0]?.text?.toLowerCase() === 'watcher' ? null : 'join'
    }
    if (translate.startsWith('multiplayer.player.left')) return 'leave'
    if (translate.startsWith('chat.type.advancement')) return null
    if (PLAYER_CHAT_TRANSLATE_KEYS.has(translate)) return 'chat'
    // Server admin command feedback — exclude silently
    if (translate.startsWith('commands.')) return null
  }

  // Player chat without translate: player names have suggest_command clickEvent
  if (jsonMsg?.with && Array.isArray(jsonMsg.with) && jsonMsg.with[0]?.clickEvent?.action === 'suggest_command') {
    // [PlayerName: command result] — bracket-wrapped command feedback, not player chat
    if (fullText.startsWith('[')) return null
    return 'chat'
  }

  if (fullText.startsWith('Teleported ')) return 'teleport'
  if (fullText.startsWith('***KRADLE***')) return 'announcement'

  // Structured kradle_command JSON embedded in chat
  if (fullText.startsWith('{')) {
    try {
      const parsed = JSON.parse(fullText)
      if (parsed?.type === 'kradle_command') return 'kradle_command'
    } catch { }
  }

  // Unclassified — log for investigation
  console.log('[chat:unclassified]', { translate, fullText, jsonMsg })
  return null
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
      if (position === 'game_info') return // action bar — handled by TitleProvider
      if (jsonMsg['unsigned']) {
        jsonMsg = jsonMsg['unsigned']
      }
      const parts = formatMessage(jsonMsg)

      if (skipChatMessages) return

      const type = classifyMessage(jsonMsg, parts)

      if (isChatCanvasEnabled() && type === 'chat') {
        addCanvasChatMessage(parts)
      }

      setMessages(m => {
        lastMessageId.current++
        const newMessage: Message = { parts, id: lastMessageId.current, faded: false }
        fadeMessage(newMessage, true, () => {
          // eslint-disable-next-line max-nested-callbacks
          setMessages(m => [...m])
        })

        if (type !== null) {
          sendMessageToParent(parts, type)
        }

        // Show chat in 3D above player heads
        if (type === 'chat') {
          const playerName = String((jsonMsg as any)?.with?.[0] ?? '').trim()
          const msgPart = (jsonMsg as any)?.with?.[1]
          const messageText = msgPart ? formatMessage(msgPart).map(p => p.text || '').join('').trim() : ''
          if (playerName && messageText) {
            getThreeJsRendererMethods()?.setPlayerChatLine(playerName, messageText)
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
      allChatMessages.length = 0
      seenMessageHashes.clear()
      nextMessageId = 0
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
