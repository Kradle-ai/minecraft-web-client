import { loadSkinToCanvas } from 'skinview-utils'
import * as THREE from 'three'
import stevePng from 'mc-assets/dist/other-textures/latest/entity/player/wide/steve.png'
import { appQueryParams } from '../../../../src/appParams'

// Kradleverse skins
import crab1 from '../../../../assets/kradleverse/crab_1.png'
import crab2 from '../../../../assets/kradleverse/crab_2.png'
import lobster1 from '../../../../assets/kradleverse/lobster_1.png'
import crabHawaiianRed from '../../../../assets/kradleverse/crab_hawaiian_red.png'
import crabHawaiianBlue from '../../../../assets/kradleverse/crab_hawaiian_blue.png'
import crabHawaiianGreen from '../../../../assets/kradleverse/crab_hawaiian_green.png'
import crabHawaiianPurple from '../../../../assets/kradleverse/crab_hawaiian_purple.png'
import crabHawaiianOrange from '../../../../assets/kradleverse/crab_hawaiian_orange.png'
import crabPirate from '../../../../assets/kradleverse/crab_pirate.png'
import crabNinjaBlack from '../../../../assets/kradleverse/crab_ninja_black.png'
import crabNinjaRed from '../../../../assets/kradleverse/crab_ninja_red.png'
import crabGolden from '../../../../assets/kradleverse/crab_golden.png'
import crabSilver from '../../../../assets/kradleverse/crab_silver.png'
import crabNeonPink from '../../../../assets/kradleverse/crab_neon_pink.png'
import crabNeonGreen from '../../../../assets/kradleverse/crab_neon_green.png'
import crabNeonCyan from '../../../../assets/kradleverse/crab_neon_cyan.png'
import crabTuxedo from '../../../../assets/kradleverse/crab_tuxedo.png'
import crabClown from '../../../../assets/kradleverse/crab_clown.png'
import crabDisco from '../../../../assets/kradleverse/crab_disco.png'
import crabCamoGreen from '../../../../assets/kradleverse/crab_camo_green.png'
import crabCamoDesert from '../../../../assets/kradleverse/crab_camo_desert.png'
import crabRainbow from '../../../../assets/kradleverse/crab_rainbow.png'
import crabZombie from '../../../../assets/kradleverse/crab_zombie.png'
import crabRobot from '../../../../assets/kradleverse/crab_robot.png'
import crabWizard from '../../../../assets/kradleverse/crab_wizard.png'
import crabChef from '../../../../assets/kradleverse/crab_chef.png'
import crabSuperhero from '../../../../assets/kradleverse/crab_superhero.png'
import crabBeach from '../../../../assets/kradleverse/crab_beach.png'

const crabSkins = [
  crab1,
  crabHawaiianRed,
  crabHawaiianBlue,
  crabHawaiianGreen,
  crabHawaiianPurple,
  crabHawaiianOrange,
  crabPirate,
  crabNinjaBlack,
  crabNinjaRed,
  crabGolden,
  crabSilver,
  crabNeonPink,
  crabNeonGreen,
  crabNeonCyan,
  crabTuxedo,
  crabClown,
  crabDisco,
  crabCamoGreen,
  crabCamoDesert,
  crabRainbow,
  crabZombie,
  crabRobot,
  crabWizard,
  crabChef,
  crabSuperhero,
  crabBeach,
]

const getRandomCrabSkin = () => crabSkins[Math.floor(Math.random() * crabSkins.length)]

const defaultSkin = appQueryParams.kradleverse ? crab1 : stevePng
export const stevePngUrl = defaultSkin
export const steveTexture = new THREE.TextureLoader().loadAsync(defaultSkin)

// Export for use when assigning skins to other players
export const isKradleverse = !!appQueryParams.kradleverse
export { getRandomCrabSkin }

export async function loadImageFromUrl (imageUrl: string): Promise<HTMLImageElement> {
  const img = new Image()

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Image load timeout: ${imageUrl}`))
    }, 10_000) // 10 second timeout

    img.onload = () => {
      clearTimeout(timeout)
      resolve(img)
    }

    img.onerror = (error) => {
      clearTimeout(timeout)
      reject(new Error(`Failed to load image: ${imageUrl}. Error: ${error instanceof Event ? error.type : String(error)}`))
    }

    img.onabort = () => {
      clearTimeout(timeout)
      reject(new Error(`Image load aborted: ${imageUrl}`))
    }

    // Enable CORS if needed
    img.crossOrigin = 'anonymous'

    // Set the source last to start loading
    img.src = imageUrl
  })
}

export function getLookupUrl (username: string, type: 'skin' | 'cape'): string {
  return `https://mineskin.eu/${type}/${username}`
}

export async function loadSkinImage (skinUrl: string): Promise<{ canvas: HTMLCanvasElement, image: HTMLImageElement }> {
  const image = await loadImageFromUrl(skinUrl)
  const skinCanvas = document.createElement('canvas')
  loadSkinToCanvas(skinCanvas, image)
  return { canvas: skinCanvas, image }
}
