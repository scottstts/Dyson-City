/**
 * The house's texture sets (blender/docs/house.md §7): image entries in the pack, stored once and
 * shared by every part. Each image is decoded once (the browser's own decoder) and uploaded once
 * per colour space, however many parts and materials use it.
 */
import { NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture, type ColorSpace } from 'three/webgpu';
import type { HousePack } from './pack';

export class HouseTextures {
  private readonly pack: HousePack;
  private readonly bitmaps = new Map<string, Promise<ImageBitmap>>();
  private readonly textures = new Map<string, Promise<Texture>>();

  constructor(pack: HousePack) {
    this.pack = pack;
  }

  private bitmap(uri: string): Promise<ImageBitmap> {
    let p = this.bitmaps.get(uri);
    if (!p) {
      const mime = String(this.pack.entry(uri).mime ?? 'image/png');
      p = this.pack.bytes(uri).then((b) => createImageBitmap(new Blob([b], { type: mime }), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
      this.bitmaps.set(uri, p);
    }
    return p;
  }

  /** Decodes every image a part names (call before building its materials). */
  async preload(uris: readonly string[]): Promise<void> {
    await Promise.all(uris.map((u) => this.bitmap(u)));
  }

  /** The shared texture for an image (glTF conventions: no flip, repeating tiles). */
  get(uri: string, colour: boolean): Promise<Texture> {
    const space: ColorSpace = colour ? SRGBColorSpace : NoColorSpace;
    const key = `${uri}|${space}`;
    let p = this.textures.get(key);
    if (!p) {
      p = this.bitmap(uri).then((bitmap) => {
        const t = new Texture(bitmap);
        t.name = uri;
        t.flipY = false;
        t.colorSpace = space;
        t.wrapS = RepeatWrapping;
        t.wrapT = RepeatWrapping;
        t.anisotropy = 8;
        t.needsUpdate = true;
        return t;
      });
      this.textures.set(key, p);
    }
    return p;
  }
}
