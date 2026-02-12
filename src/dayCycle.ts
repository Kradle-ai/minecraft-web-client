import { options } from './optionsStorage'
import { assertDefined } from './utils'
import { updateBackground } from './water'

export default () => {
  const evening = 11_500
  const night = 13_500
  const morningStart = 23_000
  const morningEnd = 23_961

  // eslint-disable-next-line unicorn/numeric-separators-style
  const dayColorDefault = { r: 0.6784313725490196, g: 0.8470588235294118, b: 0.9019607843137255 } // lightblue
  const dayColorRainy = { r: 111 / 255, g: 156 / 255, b: 236 / 255 }

  let targetInt = 1
  let currentInt = 1
  const lerpSpeed = 0.02

  const getTargetInt = () => {
    const timeProgress = options.dayCycleAndLighting ? bot.time.timeOfDay : 0
    let int = 1
    if (timeProgress < evening) {
      // stay dayily
    } else if (timeProgress < night) {
      const progressNorm = timeProgress - evening
      const progressMax = night - evening
      int = 1 - progressNorm / progressMax
    } else if (timeProgress < morningStart) {
      int = 0
    } else if (timeProgress < morningEnd) {
      const progressNorm = timeProgress - morningStart
      const progressMax = night - morningEnd
      int = progressNorm / progressMax
    }
    return int
  }

  const applyLighting = () => {
    const dayColor = bot.isRaining ? dayColorRainy : dayColorDefault
    // Sky is black at night so stars are visible, but mesh lighting stays bright
    const colorInt = currentInt
    updateBackground({ r: dayColor.r * colorInt, g: dayColor.g * colorInt, b: dayColor.b * colorInt })
    if (!options.newVersionsLighting && bot.supportFeature?.('blockStateId')) {
      appViewer.playerState.reactive.ambientLight = Math.max(currentInt, 0.6)
      appViewer.playerState.reactive.directionalLight = Math.min(currentInt, 0.5)
    }
  }

  bot.on('time', () => {
    targetInt = getTargetInt()
  })

  targetInt = getTargetInt()
  applyLighting()

  beforeRenderFrame.push(() => {
    if (Math.abs(currentInt - targetInt) > 0.001) {
      currentInt += (targetInt - currentInt) * lerpSpeed
      applyLighting()
    }
  })
}
